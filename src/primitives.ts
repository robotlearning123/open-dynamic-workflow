import { mkdirSync } from "node:fs";
import type {
  RunContext,
  RunConfig,
  WorkflowGlobals,
  Budget,
  AgentOpts,
} from "./types.js";
import { Limiter, defaultConcurrency, MAX_TOTAL_AGENTS } from "./concurrency.js";
import { createJournal, chainKey } from "./journal.js";
import { silentReporter } from "./progress.js";
import { withWorktree } from "./worktree.js";

export function createContext(cfg: RunConfig & { runId: string }): RunContext {
  const journalDir = cfg.journalDir ?? ".runs";
  mkdirSync(journalDir, { recursive: true });

  const journal = createJournal({
    runId: cfg.runId,
    dir: journalDir,
    resumeFromRunId: cfg.resumeFromRunId,
  });

  const concurrency = cfg.concurrency ?? defaultConcurrency();
  const limiter = new Limiter(concurrency);

  return {
    backend: cfg.backend,
    journal,
    reporter: cfg.reporter ?? silentReporter,
    budgetTotal: cfg.budget ?? null,
    args: cfg.args ?? null,
    state: {
      ordinal: 0,
      chain: "",
      agentCount: 0,
      tokensSpent: 0,
      currentPhase: "",
      agentSeq: 0,
    },
    ...(cfg.defaultModel !== undefined ? { defaultModel: cfg.defaultModel } : {}),
    depth: 0,
    limiterRun: limiter.run.bind(limiter),
    workflowResolver: cfg.workflowResolver,
    worktreeRoot: cfg.worktreeRoot,
    abort: { aborted: false },
  };
}

export function makeGlobals(ctx: RunContext): WorkflowGlobals {
  const budget: Budget = {
    total: ctx.budgetTotal,
    spent(): number {
      return ctx.state.tokensSpent;
    },
    remaining(): number {
      if (ctx.budgetTotal === null) return Infinity;
      return Math.max(0, ctx.budgetTotal - ctx.state.tokensSpent);
    },
  };

  function agent(prompt: string, opts: AgentOpts = {}): Promise<unknown> {
    // Synchronous, BEFORE any await: advance the invocation ordinal and the prefix CHAIN so the
    // key depends on every preceding call (prefix/cascade + reorder semantics — ANALYSIS §6).
    const ordinal = ++ctx.state.ordinal;
    const label = opts.label ?? "agent#" + ordinal;
    const phase = opts.phase ?? ctx.state.currentPhase;
    const { key, chain } = chainKey(ctx.state.chain, prompt, opts);
    ctx.state.chain = chain;
    // Deterministic agentId from ordinal sequence.
    const agentId = "a" + String(ordinal).padStart(3, "0") + "-" + (++ctx.state.agentSeq);

    // Resume: content-addressed lookup by the prefix-chained key — done BEFORE acquiring a
    // concurrency slot, so a fully-cached resume doesn't serialize through the limiter and the
    // progress telemetry reports the hit correctly (no phantom cached:false start).
    const cached = ctx.journal.lookup(key);
    if (cached.hit) {
      ctx.reporter.emit({ kind: "agent-start", ordinal, agentId, label, phase, cached: true });
      ctx.reporter.emit({ kind: "agent-done", ordinal, agentId, label, phase, cached: true, outputTokens: 0 });
      return Promise.resolve(cached.result);
    }

    ctx.reporter.emit({ kind: "agent-start", ordinal, agentId, label, phase, cached: false });

    return ctx.limiterRun(async () => {
      // Budget ceiling (best-effort pre-call gate — see note in types.ts) + lifetime cap; only for
      // live (uncached) runs. Concurrent in-flight agents can each pass the gate, so spent() may
      // overshoot `total` by up to the number of in-flight slots.
      if (ctx.budgetTotal !== null && ctx.state.tokensSpent >= ctx.budgetTotal) {
        const err = new Error("budget exhausted");
        ctx.reporter.emit({ kind: "agent-fail", ordinal, agentId, label, phase, error: err.message });
        throw err;
      }
      if (ctx.state.agentCount >= MAX_TOTAL_AGENTS) {
        const err = new Error("agent cap 1000 reached");
        ctx.reporter.emit({ kind: "agent-fail", ordinal, agentId, label, phase, error: err.message });
        throw err;
      }

      ctx.journal.recordStarted(key, agentId);

      try {
        const baseReq = {
          prompt,
          schema: opts.schema,
          model: opts.model ?? ctx.defaultModel,
          agentType: opts.agentType ?? "workflow-subagent",
          agentId,
        };
        // opts.isolation:'worktree' → run the agent in a fresh git worktree (cwd), then clean up.
        // Graceful no-op when the root isn't a git repo. Default (no isolation) is unchanged.
        const resp =
          opts.isolation === "worktree"
            ? await withWorktree(ctx.worktreeRoot ?? process.cwd(), (dir) => ctx.backend.run({ ...baseReq, cwd: dir }))
            : await ctx.backend.run(baseReq);
        ctx.state.agentCount++;
        ctx.state.tokensSpent += resp.outputTokens;
        ctx.journal.recordResult(key, agentId, resp.output);
        ctx.reporter.emit({
          kind: "agent-done",
          ordinal,
          agentId,
          label,
          phase,
          cached: false,
          outputTokens: resp.outputTokens,
        });
        return resp.output;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        ctx.reporter.emit({ kind: "agent-fail", ordinal, agentId, label, phase, error: errMsg });
        throw e;
      }
    });
  }

  function parallel(thunks: Array<() => Promise<unknown>>): Promise<unknown[]> {
    // Fidelity (traces/experiment-05): the real parallel() catches a thunk's ASYNC rejection
    // (e.g. an agent error) -> null, but a SYNCHRONOUS throw in the thunk body propagates and
    // crashes the workflow. `t().then(ok, ()=>null)` reproduces BOTH: a synchronous throw in
    // t() escapes the .map callback (never wrapped), while a rejected promise becomes null.
    return Promise.all(thunks.map((t) => t().then((v) => v, () => null)));
  }

  function pipeline(items: unknown[], ...stages: Array<(prev: unknown, original: unknown, index: number) => unknown>): Promise<unknown[]> {
    return Promise.all(
      items.map((item, i) =>
        (async () => {
          try {
            let acc: unknown = item;
            for (const stage of stages) {
              acc = await stage(acc, item, i);
            }
            return acc;
          } catch {
            return null;
          }
        })()
      )
    );
  }

  function phase(title: string): void {
    ctx.state.currentPhase = title;
    ctx.reporter.emit({ kind: "phase", title });
  }

  function log(message: string): void {
    ctx.reporter.emit({ kind: "log", message });
  }

  async function workflow(
    ref: string | { scriptPath: string },
    wfArgs?: unknown
  ): Promise<unknown> {
    if (ctx.depth >= 1) {
      // Exact message observed from the real engine in traces/experiment-05-boundaries.
      throw new Error(
        "workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly.",
      );
    }
    if (!ctx.workflowResolver) {
      throw new Error("workflowResolver not configured");
    }
    const source = await ctx.workflowResolver(ref);
    // Lazy import to avoid circular dependency — runner.ts is not yet in scope here.
    // We reconstruct a child context sharing all counters/journal/limiter.
    const childCtx: RunContext = {
      ...ctx,
      args: wfArgs ?? null,
      depth: ctx.depth + 1,
    };
    const childGlobals = makeGlobals(childCtx);
    // Run the child in the SAME node:vm sandbox as the top-level runner (shared runInSandbox), so a
    // nested workflow gets the same Date.now()/Math.random()/require blocking — preserving resume
    // determinism. Dynamic import breaks the static circular dependency with runner.ts.
    const { runInSandbox } = await import("./runner.js");
    return runInSandbox(source, childGlobals as unknown as Record<string, unknown>);
  }

  return { agent, parallel, pipeline, phase, log, args: ctx.args, budget, workflow };
}
