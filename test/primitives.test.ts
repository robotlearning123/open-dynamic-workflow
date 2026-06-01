import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentBackend, AgentRequest, AgentResponse } from "../src/types.js";
import { createContext, makeGlobals } from "../src/primitives.js";
import { MAX_TOTAL_AGENTS } from "../src/concurrency.js";
import { silentReporter } from "../src/progress.js";

// ---------- helpers ----------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "odw-test-"));
}

class MockBackend implements AgentBackend {
  readonly calls: AgentRequest[] = [];
  private readonly responder: (req: AgentRequest) => unknown;
  private readonly delayMs: number;

  constructor(o?: { responder?: (req: AgentRequest) => unknown; delayMs?: number }) {
    this.responder = o?.responder ?? ((req) => `echo:${req.prompt}`);
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

class ThrowingBackend implements AgentBackend {
  async run(_req: AgentRequest): Promise<AgentResponse> {
    throw new Error("backend should not be called");
  }
}

function makeCtx(
  backend: AgentBackend,
  extra: {
    journalDir?: string;
    budget?: number | null;
    runId?: string;
    resumeFromRunId?: string;
  } = {}
) {
  const journalDir = extra.journalDir ?? makeTmpDir();
  const runId = extra.runId ?? ("test-" + Math.random().toString(36).slice(2));
  return createContext({
    backend,
    journalDir,
    runId,
    resumeFromRunId: extra.resumeFromRunId,
    budget: extra.budget,
    reporter: silentReporter,
  });
}

// ---------- (a) parallel: order preserved + throwing thunk -> null ----------

describe("parallel", () => {
  it("preserves order and converts thrown thunks to null", async () => {
    const ctx = makeCtx(new MockBackend());
    const { parallel } = makeGlobals(ctx);

    const results = await parallel([
      async () => "first",
      async () => {
        throw new Error("boom");
      },
      async () => "third",
    ]);

    expect(results).toEqual(["first", null, "third"]);
  });

  it("async rejection -> null, but a SYNCHRONOUS throw propagates (matches real engine, traces/experiment-05)", async () => {
    const ctx = makeCtx(new MockBackend());
    const { parallel } = makeGlobals(ctx);
    // async rejection (e.g. an agent error) is caught -> null
    await expect(parallel([() => Promise.reject(new Error("async-boom"))])).resolves.toEqual([null]);
    // a synchronous throw in the thunk body is NOT wrapped -> it escapes parallel() synchronously
    // (in a real workflow `await parallel([...])` then rejects and the run fails — traces/experiment-05).
    expect(() => parallel([() => { throw new Error("sync-boom"); }])).toThrow("sync-boom");
  });

  it("all thunks run concurrently (barrier)", async () => {
    const ctx = makeCtx(new MockBackend());
    const { parallel } = makeGlobals(ctx);
    const order: string[] = [];

    const results = await parallel([
      async () => {
        order.push("start-0");
        await new Promise<void>((r) => setTimeout(r, 20));
        order.push("end-0");
        return "a";
      },
      async () => {
        order.push("start-1");
        await new Promise<void>((r) => setTimeout(r, 5));
        order.push("end-1");
        return "b";
      },
    ]);

    expect(results).toEqual(["a", "b"]);
    // Both started before either ended (concurrent)
    expect(order[0]).toBe("start-0");
    expect(order[1]).toBe("start-1");
  });
});

// ---------- (b) pipeline: NO inter-stage barrier + stage args ----------

describe("pipeline", () => {
  it("no inter-stage barrier: fast item reaches stage2 before slow item finishes stage1", async () => {
    const ctx = makeCtx(new MockBackend());
    const { pipeline } = makeGlobals(ctx);

    const globalLog: string[] = [];

    // item0 is slow in stage1; item1 is fast in stage1
    const results = await pipeline(
      ["item0", "item1"],
      // stage 1
      async (prev: unknown, _original: unknown, index: number) => {
        const delay = index === 0 ? 40 : 5;
        globalLog.push(`stage1_start_${index}`);
        await new Promise<void>((r) => setTimeout(r, delay));
        globalLog.push(`stage1_done_${index}`);
        return String(prev) + "_s1";
      },
      // stage 2
      async (prev: unknown, _original: unknown, index: number) => {
        globalLog.push(`stage2_start_${index}`);
        return String(prev) + "_s2";
      }
    );

    // item1 should reach stage2 before item0 finishes stage1
    const stage2Item1 = globalLog.indexOf("stage2_start_1");
    const stage1DoneItem0 = globalLog.indexOf("stage1_done_0");
    expect(stage2Item1).toBeGreaterThan(-1);
    expect(stage1DoneItem0).toBeGreaterThan(-1);
    // NO inter-stage barrier: item1 enters stage2 before item0 finishes stage1
    expect(stage2Item1).toBeLessThan(stage1DoneItem0);

    expect(results).toEqual(["item0_s1_s2", "item1_s1_s2"]);
  });

  it("stage receives (prev, original, index) and stage1 prev===item", async () => {
    const ctx = makeCtx(new MockBackend());
    const { pipeline } = makeGlobals(ctx);

    const stageArgs: Array<[unknown, unknown, number]> = [];

    await pipeline(
      ["x", "y"],
      (prev, original, index) => {
        stageArgs.push([prev, original, index]);
        return String(prev) + "_out";
      }
    );

    // stage1: prev === item (original item)
    expect(stageArgs[0][0]).toBe("x");
    expect(stageArgs[0][1]).toBe("x");
    expect(stageArgs[0][2]).toBe(0);
    expect(stageArgs[1][0]).toBe("y");
    expect(stageArgs[1][1]).toBe("y");
    expect(stageArgs[1][2]).toBe(1);
  });

  it("stage throwing makes that item null", async () => {
    const ctx = makeCtx(new MockBackend());
    const { pipeline } = makeGlobals(ctx);

    const results = await pipeline(
      ["a", "b", "c"],
      async (prev: unknown) => {
        if (prev === "b") throw new Error("fail");
        return prev;
      }
    );

    expect(results).toEqual(["a", null, "c"]);
  });
});

// ---------- (c) budget ceiling ----------

describe("budget", () => {
  it("throws 'budget exhausted' when budget=0 and agent is called directly", async () => {
    const ctx = makeCtx(new MockBackend(), { budget: 0 });
    const { agent } = makeGlobals(ctx);

    await expect(agent("hello")).rejects.toThrow("budget exhausted");
  });

  it("parallel wraps budget error as null", async () => {
    const ctx = makeCtx(new MockBackend(), { budget: 0 });
    const { parallel, agent } = makeGlobals(ctx);

    const results = await parallel([
      () => agent("hello"),
    ]);

    expect(results).toEqual([null]);
  });
});

// ---------- (c2) lifetime agent cap = 1000 (ANALYSIS §10) ----------

describe("agent lifetime cap", () => {
  it("MAX_TOTAL_AGENTS is 1000 (documented hard limit)", () => {
    expect(MAX_TOTAL_AGENTS).toBe(1000);
  });

  it("throws once the 1000-agent lifetime cap is reached", async () => {
    const ctx = makeCtx(new MockBackend());
    const { agent } = makeGlobals(ctx);
    ctx.state.agentCount = MAX_TOTAL_AGENTS; // simulate cap reached without spawning 1000 agents
    await expect(agent("one more")).rejects.toThrow("agent cap 1000 reached");
  });
});

// ---------- (d) resume: cached results returned without backend calls ----------

describe("resume", () => {
  it("second run with resumeFromRunId serves all results from cache, zero backend calls", async () => {
    const journalDir = makeTmpDir();
    const runId1 = "run-first";

    // First run: 3 sequential agents
    const backend1 = new MockBackend({ responder: (req) => `result:${req.prompt}` });
    const ctx1 = makeCtx(backend1, { journalDir, runId: runId1 });
    const g1 = makeGlobals(ctx1);

    const r1 = await g1.agent("prompt-a");
    const r2 = await g1.agent("prompt-b");
    const r3 = await g1.agent("prompt-c");

    expect(r1).toBe("result:prompt-a");
    expect(r2).toBe("result:prompt-b");
    expect(r3).toBe("result:prompt-c");
    expect(backend1.calls.length).toBe(3);

    // Second run: same script (same prompts in same order), resume from first run
    const runId2 = "run-second";
    const backend2 = new ThrowingBackend();
    const ctx2 = makeCtx(backend2, {
      journalDir,
      runId: runId2,
      resumeFromRunId: runId1,
    });
    const g2 = makeGlobals(ctx2);

    const rr1 = await g2.agent("prompt-a");
    const rr2 = await g2.agent("prompt-b");
    const rr3 = await g2.agent("prompt-c");

    // All from cache
    expect(rr1).toBe("result:prompt-a");
    expect(rr2).toBe("result:prompt-b");
    expect(rr3).toBe("result:prompt-c");
    // ThrowingBackend would throw if called — no calls means all were cached
  });
});
