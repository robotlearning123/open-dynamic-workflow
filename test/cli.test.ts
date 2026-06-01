import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, run, CliUsageError } from "../src/cli.js";
import { silentReporter } from "../src/progress.js";

const argv = (...a: string[]): string[] => ["node", "cli", ...a];

describe("cli parseArgs", () => {
  it("parses the script + all flags", () => {
    const p = parseArgs(argv("s.js", "--mock", "--budget", "100", "--args", '{"x":1}', "--resume", "r1", "--json-dir", "/tmp/j"));
    expect(p).toEqual({ script: "s.js", mock: true, budget: 100, args: { x: 1 }, resumeRunId: "r1", jsonDir: "/tmp/j" });
  });

  it("throws CliUsageError on bad input", () => {
    expect(() => parseArgs(argv())).toThrow(CliUsageError); // no script
    expect(() => parseArgs(argv("s.js", "--budget", "-1"))).toThrow(/budget/);
    expect(() => parseArgs(argv("s.js", "--budget", "abc"))).toThrow(/budget/);
    expect(() => parseArgs(argv("s.js", "--args", "{bad"))).toThrow(/invalid JSON/);
    expect(() => parseArgs(argv("s.js", "--nope"))).toThrow(/Unknown/);
  });
});

describe("cli run", () => {
  it("runs a workflow with --mock and returns code 0 + result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odw-cli-"));
    const script = join(dir, "w.js");
    writeFileSync(script, "export const meta={name:'c',description:'d'};\nreturn await agent('hi',{label:'a'});\n");
    const r = await run(argv(script, "--mock", "--json-dir", join(dir, ".runs")), { reporter: silentReporter });
    expect(r.code).toBe(0);
    expect(typeof r.result).toBe("string");
    expect(r.runId).toBeTruthy();
  });

  it("returns code 1 on a missing script", async () => {
    const r = await run(argv("/no/such/file.js", "--mock"), { reporter: silentReporter });
    expect(r.code).toBe(1);
  });

  it("returns code 1 on a usage error (no script)", async () => {
    expect((await run(argv(), { reporter: silentReporter })).code).toBe(1);
  });
});
