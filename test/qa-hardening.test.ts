import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Limiter } from "../src/concurrency.js";
import { createContext, makeGlobals } from "../src/primitives.js";
import { AnthropicBackend } from "../src/backend.js";
import { HttpAgentBackend } from "../src/http-agent-backend.js";
import { validate } from "../src/structured-output.js";
import { parseMeta } from "../src/runner.js";
import type { AgentBackend, ProgressEvent } from "../src/types.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "odw-qa-"));

describe("Limiter validation + slot safety (C1/C2)", () => {
  it("rejects non-positive / NaN max instead of silently deadlocking [C1]", () => {
    expect(() => new Limiter(0)).toThrow(RangeError);
    expect(() => new Limiter(-1)).toThrow();
    expect(() => new Limiter(Number.NaN)).toThrow();
    expect(new Limiter(2)).toBeInstanceOf(Limiter);
  });

  it("does not leak a slot when fn() throws synchronously [C2]", async () => {
    const lim = new Limiter(1);
    await expect(lim.run(() => { throw new Error("sync"); })).rejects.toThrow("sync");
    // slot must be released — a subsequent run completes (would hang forever if leaked)
    await expect(lim.run(async () => "ok")).resolves.toBe("ok");
    expect(lim.active).toBe(0);
  });
});

describe("agent() error path (T2)", () => {
  it("emits agent-fail and re-throws when the backend throws", async () => {
    const failBackend: AgentBackend = { run: async () => { throw new Error("API down"); } };
    const events: ProgressEvent[] = [];
    const ctx = createContext({ backend: failBackend, journalDir: tmp(), runId: "fail-1", reporter: { emit: (e) => events.push(e) } });
    const { agent } = makeGlobals(ctx);
    await expect(agent("x")).rejects.toThrow("API down");
    expect(events.some((e) => e.kind === "agent-fail" && e.error === "API down")).toBe(true);
  });
});

describe("AnthropicBackend tool-use edge cases (T3/B2)", () => {
  function client(turns: unknown[], capture?: unknown[]) {
    let i = 0;
    return { messages: { create: async (p: unknown) => { capture?.push(JSON.parse(JSON.stringify(p))); return turns[i++]; } } };
  }
  const toolUse = (id: string, name: string, input: unknown) => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
  const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });

  it("wraps a throwing tool handler as a tool_result and continues [T3]", async () => {
    const be = new AnthropicBackend({
      client: client([toolUse("t1", "bad", {}), text("worked around it")]) as never,
      tools: [{ name: "bad", description: "", input_schema: { type: "object" }, handler: () => { throw new Error("oops"); } }],
    });
    expect(await (await be.run({ agentId: "a", prompt: "x" })).output).toBe("worked around it");
  });

  it("sends a non-empty tool_result content when the handler returns undefined [B2]", async () => {
    const calls: any[] = [];
    const be = new AnthropicBackend({
      client: client([toolUse("u1", "u", {}), text("done")], calls) as never,
      tools: [{ name: "u", description: "", input_schema: { type: "object" }, handler: () => undefined }],
    });
    await be.run({ agentId: "a", prompt: "x" });
    const userMsg = calls[1].messages.find((m: any) => m.role === "user" && Array.isArray(m.content));
    const tr = userMsg.content.find((b: any) => b.type === "tool_result");
    expect(tr).toBeDefined();
    expect(tr.content).toBe("null"); // not undefined/omitted
  });
});

describe("validate deepEqual for enum object/array values (T5)", () => {
  it("compares enum object values deeply", () => {
    const schema = { enum: [{ a: 1, b: [2, 3] }] };
    expect(validate({ a: 1, b: [2, 3] }, schema).ok).toBe(true);
    expect(validate({ a: 1, b: [2, 4] }, schema).ok).toBe(false);
    expect(validate({ a: 1, b: [2] }, schema).ok).toBe(false);
    expect(validate({ a: 1, b: [2, 3], c: 0 }, schema).ok).toBe(false);
  });
});

describe("parseMeta ignores literals (R1/R2)", () => {
  it("does not match `export const meta =` inside a string literal [R1]", () => {
    const src = "const decoy = \"export const meta = { name: 'fake', description: 'x' }\";\nexport const meta = { name: 'real', description: 'd' };\nreturn 1;";
    expect(parseMeta(src).name).toBe("real");
  });

  it("does not match `export const meta =` inside a regex literal [R1]", () => {
    const src = "const decoy = /export const meta = { name: 'fake', description: 'x' }/;\nexport const meta = { name: 'real', description: 'd' };\nreturn 1;";
    expect(parseMeta(src).name).toBe("real");
  });

  it("does not match `export const meta =` inside statement-position regex literals [R1]", () => {
    const src = "function decoy(){ return /export const meta = { name: 'fake', description: 'x' }/; }\ntry { throw /export const meta = { name: 'also-fake', description: 'x' }/; } catch {}\nexport const meta = { name: 'real', description: 'd' };\nreturn 1;";
    expect(parseMeta(src).name).toBe("real");
  });

  it("handles an escaped backtick inside a template value [R2]", () => {
    const src = "export const meta = { name: `a\\`b`, description: 'd' };\nreturn 1;";
    expect(parseMeta(src).name).toBe("a`b");
  });
});

describe("HttpAgentBackend timeout + custom hooks (T7)", () => {
  it("aborts on timeout", async () => {
    const be = new HttpAgentBackend({
      url: "https://x",
      timeoutMs: 40,
      fetchImpl: ((_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch,
    });
    await expect(be.run({ agentId: "a", prompt: "p" })).rejects.toThrow();
  });

  it("uses custom buildBody + parseResponse", async () => {
    let seen: any;
    const fetchImpl = (async (_u: string, init: { body: string }) => {
      seen = JSON.parse(init.body);
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ x: "R" }) };
    }) as unknown as typeof fetch;
    const be = new HttpAgentBackend({
      url: "https://x",
      fetchImpl,
      buildBody: (req) => ({ custom: req.prompt }),
      parseResponse: (j: any) => ({ output: j.x, outputTokens: 9 }),
    });
    const r = await be.run({ agentId: "a", prompt: "P" });
    expect(seen.custom).toBe("P");
    expect(r.output).toBe("R");
    expect(r.outputTokens).toBe(9);
  });
});
