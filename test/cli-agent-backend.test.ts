import { describe, it, expect } from "vitest";
import { CliAgentBackend, extractJson } from "../src/cli-agent-backend.js";
import type { AgentRequest } from "../src/types.js";

const req = (o: Partial<AgentRequest> = {}): AgentRequest => ({ agentId: "a1", prompt: "hello", ...o });

describe("CliAgentBackend (local real-agent dispatch)", () => {
  it("dispatches to a CLI process and returns its stdout as text", async () => {
    const be = CliAgentBackend.custom({
      buildCommand: (r) => ({ cmd: "node", args: ["-e", 'process.stdout.write("echo:"+process.argv[1])', r.prompt] }),
    });
    const res = await be.run(req({ prompt: "world" }));
    expect(res.output).toBe("echo:world");
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it("extracts JSON from stdout when a schema is set", async () => {
    const be = CliAgentBackend.custom({
      buildCommand: () => ({ cmd: "node", args: ["-e", 'process.stdout.write(JSON.stringify({id:1,note:"x"}))'] }),
    });
    const res = await be.run(req({ schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } }));
    expect(res.output).toEqual({ id: 1, note: "x" });
  });

  it("passes the prompt via stdin when input is set (no shell injection — args array)", async () => {
    const be = CliAgentBackend.custom({
      buildCommand: (r) => ({
        cmd: "node",
        args: ["-e", 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write("in:"+s))'],
        input: r.prompt,
      }),
    });
    const res = await be.run(req({ prompt: "$(rm -rf /); piped" }));
    expect(res.output).toBe("in:$(rm -rf /); piped");
  });

  it("rejects when the agent exits non-zero with no output", async () => {
    const be = CliAgentBackend.custom({ buildCommand: () => ({ cmd: "node", args: ["-e", "process.exit(3)"] }) });
    await expect(be.run(req())).rejects.toThrow();
  });

  it("rejects (and kills the process) on timeout", async () => {
    const be = CliAgentBackend.custom({
      buildCommand: () => ({ cmd: "node", args: ["-e", "setTimeout(()=>{}, 10000)"] }),
      timeoutMs: 300,
    });
    await expect(be.run(req())).rejects.toThrow(/timed out/);
  });

  it("rejects when the command does not exist (spawn error)", async () => {
    const be = CliAgentBackend.custom({ buildCommand: () => ({ cmd: "odw-no-such-binary-xyz", args: [] }) });
    await expect(be.run(req())).rejects.toThrow();
  });

  it("rejects on a non-zero exit even WITH stdout (H3: no silent corruption)", async () => {
    const be = CliAgentBackend.custom({
      buildCommand: () => ({ cmd: "node", args: ["-e", 'process.stdout.write("partial-garbage");process.exit(7)'] }),
    });
    await expect(be.run(req())).rejects.toThrow(/exited 7/);
  });

  it("does not crash the process on stdin EPIPE (H2)", async () => {
    // agent exits 0 without reading; writing a large prompt to its closed stdin emits EPIPE,
    // which must be handled (not an unhandled 'error' that aborts the orchestrator).
    const be = CliAgentBackend.custom({
      buildCommand: (r) => ({ cmd: "node", args: ["-e", "process.exit(0)"], input: r.prompt }),
    });
    await expect(be.run(req({ prompt: "x".repeat(200_000) }))).resolves.toBeDefined();
  });

  it("presets construct without spawning", () => {
    expect(CliAgentBackend.claude({ model: "sonnet", bare: true })).toBeInstanceOf(CliAgentBackend);
    expect(CliAgentBackend.worker("ccz")).toBeInstanceOf(CliAgentBackend);
    expect(CliAgentBackend.codex({ model: "gpt-5.4" })).toBeInstanceOf(CliAgentBackend);
    expect(CliAgentBackend.opencode({ model: "anthropic/claude-sonnet-4-6" })).toBeInstanceOf(CliAgentBackend);
  });

  it("worker() does NOT leak the pool routing label (req.model) as --model (B1)", () => {
    // In a pool, req.model is the routing label (matched against route.match), not a CLI model.
    // Forwarding it as `--model ccz` makes the wrapper call its API with an invalid model (400).
    const inv = CliAgentBackend.worker("ccz").buildInvocation(req({ model: "ccz", agentType: "ccz" }));
    expect(inv.cmd).toBe("ccz");
    expect(inv.args).not.toContain("--model");
    expect(inv.args).toContain("-p");
    expect(inv.args).toContain("--dangerously-skip-permissions");
    expect(inv.args).toContain("hello"); // the prompt is still passed
  });

  it("worker() honors an explicit configured model (o.model) as --model", () => {
    const inv = CliAgentBackend.worker("ccd", { model: "deepseek-v4" }).buildInvocation(req({ model: "routing-label" }));
    expect(inv.args).toContain("--model");
    expect(inv.args[inv.args.indexOf("--model") + 1]).toBe("deepseek-v4");
  });

  it("worker() appends extraArgs (e.g. lean flags) before the prompt (B2)", () => {
    const inv = CliAgentBackend.worker("ccz", { extraArgs: ["--bare", "--max-turns", "1"] }).buildInvocation(req({ prompt: "P" }));
    expect(inv.args).toEqual(["-p", "--dangerously-skip-permissions", "--bare", "--max-turns", "1", "P"]);
  });

  it("claude() still forwards req.model as --model (unchanged by the worker() fix)", () => {
    const inv = CliAgentBackend.claude().buildInvocation(req({ model: "sonnet" }));
    expect(inv.args).toContain("--model");
    expect(inv.args[inv.args.indexOf("--model") + 1]).toBe("sonnet");
  });
});

describe("extractJson", () => {
  it("parses whole / fenced / embedded JSON, undefined otherwise", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("```json\n{\"b\":2}\n```")).toEqual({ b: 2 });
    expect(extractJson('prefix {"c":3} suffix')).toEqual({ c: 3 });
    expect(extractJson("no json here")).toBeUndefined();
  });
});
