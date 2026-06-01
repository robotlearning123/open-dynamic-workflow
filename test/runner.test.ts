import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentBackend, AgentRequest, AgentResponse } from "../src/types.js";
import { parseMeta, runWorkflow } from "../src/runner.js";
import { silentReporter } from "../src/progress.js";

// ---------- helpers ----------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "odw-runner-test-"));
}

class MockBackend implements AgentBackend {
  readonly calls: AgentRequest[] = [];
  private readonly responder: (req: AgentRequest) => unknown;
  private readonly delayMs: number;

  constructor(o?: { responder?: (req: AgentRequest) => unknown; delayMs?: number }) {
    this.responder = o?.responder ?? ((req) => `echo:${req.prompt.slice(0, 40)}`);
    this.delayMs = o?.delayMs ?? 0;
  }

  async run(req: AgentRequest): Promise<AgentResponse> {
    if (this.delayMs > 0) {
      await new Promise<void>((res) => setTimeout(res, this.delayMs));
    }
    this.calls.push(req);
    const output = this.responder(req);
    return {
      output,
      inputTokens: 1,
      outputTokens: Math.ceil(JSON.stringify(output).length / 4),
    };
  }
}

function makeRunCfg(
  backend: AgentBackend,
  journalDir: string,
  extra: { runId?: string } = {}
) {
  return {
    backend,
    journalDir,
    reporter: silentReporter,
    ...extra,
  };
}

// ---------- (a) script with phases + parallel + return value ----------

describe("runWorkflow", () => {
  it("executes phases + parallel agents and returns the workflow return value", async () => {
    const backend = new MockBackend({ responder: (req) => `result:${req.prompt.slice(0, 10)}` });
    const journalDir = makeTmpDir();

    const source = `
export const meta = {
  name: "test-workflow",
  description: "Integration test workflow",
};

phase("setup");
log("starting");

const results = await parallel([
  () => agent("task-a"),
  () => agent("task-b"),
  () => agent("task-c"),
]);

phase("done");
return results;
`;

    const cfg = makeRunCfg(backend, journalDir, { runId: "test-run-a" });
    const r = await runWorkflow(source, cfg);

    expect(r.result).toEqual([
      "result:task-a",
      "result:task-b",
      "result:task-c",
    ]);
    expect(r.runId).toBe("test-run-a");
    expect(r.agentCount).toBe(3);
    expect(r.tokensSpent).toBeGreaterThan(0);
    expect(typeof r.journalPath).toBe("string");
    expect(backend.calls.length).toBe(3);
  });

  it("runId defaults to deterministic wf_ hash (no Date/random) when not supplied", async () => {
    const backend = new MockBackend();
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
return 1;
`;
    const cfg = makeRunCfg(backend, journalDir);
    const r = await runWorkflow(source, cfg);
    expect(r.runId).toMatch(/^wf_[0-9a-f]{12}$/);
  });

  it("same source + args always produces the same deterministic runId", async () => {
    const backend = new MockBackend();
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
return 2;
`;
    const cfg = makeRunCfg(backend, journalDir);
    const r1 = await runWorkflow(source, cfg);
    // Use a different journalDir so the second run can write its own journal.
    const journalDir2 = makeTmpDir();
    const r2 = await runWorkflow(source, { ...cfg, journalDir: journalDir2 });
    expect(r1.runId).toBe(r2.runId);
  });
});

// ---------- (b) parseMeta ----------

describe("parseMeta", () => {
  it("extracts name and description from a simple meta block", () => {
    const source = `
export const meta = {
  name: "my-workflow",
  description: "Does something useful",
};

export async function run() {}
`;
    const m = parseMeta(source);
    expect(m.name).toBe("my-workflow");
    expect(m.description).toBe("Does something useful");
  });

  it("extracts nested phases array", () => {
    const source = `
export const meta = {
  name: "phased",
  description: "Has phases",
  phases: [
    { title: "phase1", detail: "first" },
    { title: "phase2" },
  ],
};
`;
    const m = parseMeta(source);
    expect(m.name).toBe("phased");
    expect(Array.isArray(m.phases)).toBe(true);
    expect(m.phases![0].title).toBe("phase1");
  });

  it("throws when name is missing", () => {
    const source = `export const meta = { description: "no name" };`;
    expect(() => parseMeta(source)).toThrow();
  });

  it("throws when description is missing", () => {
    const source = `export const meta = { name: "no-desc" };`;
    expect(() => parseMeta(source)).toThrow();
  });

  it("throws when meta block is absent", () => {
    const source = `const x = 5;`;
    expect(() => parseMeta(source)).toThrow();
  });
});

// ---------- (c) sandbox: Date.now(), Math.random(), new Date(arg) ----------

describe("sandbox safety", () => {
  const DATE_MSG =
    "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). " +
    "Stamp results after the workflow returns, or pass timestamps via args.";

  const RANDOM_MSG =
    "Math.random() is unavailable in workflow scripts (breaks resume). " +
    "For N independent samples, include the index in the agent label or prompt.";

  function makeCfg(journalDir: string) {
    return makeRunCfg(new MockBackend(), journalDir, { runId: "sandbox-test" });
  }

  it("Date.now() rejects with the exact message", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
const t = Date.now();
return t;
`;
    await expect(runWorkflow(source, makeCfg(journalDir))).rejects.toThrow(DATE_MSG);
  });

  it("new Date() (no args) rejects with the exact message", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
const d = new Date();
return d;
`;
    await expect(runWorkflow(source, makeCfg(journalDir))).rejects.toThrow(DATE_MSG);
  });

  it("new Date(0) works (arg provided)", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
const d = new Date(0);
return d.toISOString();
`;
    const r = await runWorkflow(source, makeCfg(journalDir));
    expect(r.result).toBe("1970-01-01T00:00:00.000Z");
  });

  it("Math.random() rejects with the exact message", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
const v = Math.random();
return v;
`;
    await expect(runWorkflow(source, makeCfg(journalDir))).rejects.toThrow(RANDOM_MSG);
  });

  it("Math.floor and other Math methods still work", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
return Math.floor(3.7);
`;
    const r = await runWorkflow(source, makeCfg(journalDir));
    expect(r.result).toBe(3);
  });
});

// ---------- (d) require, process, fetch are undefined inside scripts ----------

describe("sandbox isolation", () => {
  it("typeof require === 'undefined' inside the script", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
return typeof require;
`;
    const r = await runWorkflow(source, makeRunCfg(new MockBackend(), journalDir, { runId: "iso-require" }));
    expect(r.result).toBe("undefined");
  });

  it("typeof process === 'undefined' inside the script", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
return typeof process;
`;
    const r = await runWorkflow(source, makeRunCfg(new MockBackend(), journalDir, { runId: "iso-process" }));
    expect(r.result).toBe("undefined");
  });

  it("typeof fetch === 'undefined' inside the script", async () => {
    const journalDir = makeTmpDir();
    const source = `
export const meta = { name: "n", description: "d" };
return typeof fetch;
`;
    const r = await runWorkflow(source, makeRunCfg(new MockBackend(), journalDir, { runId: "iso-fetch" }));
    expect(r.result).toBe("undefined");
  });
});
