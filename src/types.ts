// Public contract for open-dynamic-workflow — an evidence-grounded 1:1 reproduction of
// Claude Code "dynamic workflows". Every type here mirrors a behavior empirically observed
// in traces/ (see ANALYSIS.md / SPEC.md for the citing trace artifact). This file is the
// SHARED CONTRACT: all modules implement against it; fan-out implementers must not change it.

// ---------- JSON / schema ----------

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Minimal JSON Schema subset we support for structured output (matches what the real
 *  StructuredOutput tool accepts: object/array/string/number/integer/boolean + enum). */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  [k: string]: unknown; // passthrough (additionalProperties, etc.)
}

// ---------- agent options (mirrors the real agent() opts) ----------

export interface AgentOpts {
  label?: string;
  phase?: string;
  schema?: JsonSchema;
  /** Alias ('sonnet'|'haiku'|'opus') or full model id. Resolved by the backend. */
  model?: string;
  isolation?: "worktree";
  /** Default subagent type observed in traces: "workflow-subagent". */
  agentType?: string;
}

// ---------- meta (the `export const meta = {...}` block) ----------

export interface PhaseMeta {
  title: string;
  detail?: string;
  model?: string;
}

export interface Meta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: PhaseMeta[];
  model?: string;
}

// ---------- budget (output-token counter; ceiling is a best-effort pre-call gate) ----------
// agent() throws when spent() >= total at the moment it is called. It is NOT a strict cap: an
// in-flight agent has no per-call clamp (so a single agent can overshoot), and N concurrent agents
// can each pass the gate before any increment lands. This mirrors a call-time `spent>=total` check.

export interface Budget {
  /** null when no target set (then remaining() === Infinity). */
  total: number | null;
  /** cumulative OUTPUT tokens spent (matches budget.spent() observed in traces). */
  spent(): number;
  /** total===null ? Infinity : max(0, total - spent()). */
  remaining(): number;
}

// ---------- backend (one agent() call == one backend.run) ----------

export interface AgentRequest {
  prompt: string;
  schema?: JsonSchema;
  /** resolved/aliased model. */
  model?: string;
  agentType?: string;
  /** stable id assigned by the engine (mirrors agent-<id> in traces). */
  agentId: string;
  /** Working directory for this agent (set by the engine for worktree isolation). */
  cwd?: string;
}

export interface AgentResponse {
  /** Parsed structured object when schema given; otherwise the final text string. */
  output: unknown;
  inputTokens: number;
  /** counted into budget.spent(). */
  outputTokens: number;
}

export interface AgentBackend {
  run(req: AgentRequest): Promise<AgentResponse>;
}

// ---------- journal / resume (append-only 2-event model, exactly as observed) ----------

// Append-only, 2-event model — exact shape observed in real traces: {type,key,agentId,result?}.
export type JournalEvent =
  | { type: "started"; key: string; agentId: string }
  | { type: "result"; key: string; agentId: string; result: unknown };

export interface Journal {
  readonly runId: string;
  readonly path: string;
  /** Content-addressed resume: a call hits iff its prefix-CHAINED key is present in the prior
   *  run's results. Because the key chains over all preceding calls (see journal.chainKey), a
   *  single edit cascades to every later key (prefix semantics, traces/experiment-06) and a
   *  concurrent reorder perturbs the chain from that point on (traces/experiment-02). */
  lookup(key: string): { hit: true; result: unknown } | { hit: false };
  recordStarted(key: string, agentId: string): void;
  recordResult(key: string, agentId: string, result: unknown): void;
  flush(): void;
}

// ---------- progress (drives the phase/agent tree + narrator) ----------

export type ProgressEvent =
  | { kind: "phase"; title: string }
  | { kind: "log"; message: string }
  | { kind: "agent-start"; ordinal: number; agentId: string; label: string; phase: string; cached: boolean }
  | { kind: "agent-done"; ordinal: number; agentId: string; label: string; phase: string; cached: boolean; outputTokens: number }
  | { kind: "agent-fail"; ordinal: number; agentId: string; label: string; phase: string; error: string };

export interface ProgressReporter {
  emit(event: ProgressEvent): void;
}

// ---------- run config / result ----------

export type WorkflowResolver = (nameOrRef: string | { scriptPath: string }) => Promise<string>;

export interface RunConfig {
  args?: unknown;
  backend: AgentBackend;
  resumeFromRunId?: string;
  /** Output-token ceiling (best-effort pre-call gate; see Budget note). null/undefined = unlimited. */
  budget?: number | null;
  runId?: string;
  reporter?: ProgressReporter;
  /** Directory holding per-run journal dirs. Default ".runs". */
  journalDir?: string;
  /** Max concurrent agents. Default = min(16, cores-2). */
  concurrency?: number;
  workflowResolver?: WorkflowResolver;
  /** Named-workflow registry for `workflow('name')` (name -> script file path). */
  workflows?: Record<string, string>;
  /** Git repo root used to provision worktrees for agents with opts.isolation='worktree'.
   *  Defaults to process.cwd(); isolation is a no-op if this is not a git repo. */
  worktreeRoot?: string;
  /** Default model passed to every agent() call that does not specify opts.model.
   *  Propagated into RunContext.defaultModel so primitives can resolve it. */
  defaultModel?: string;
}

export interface RunResult {
  result: unknown;
  runId: string;
  journalPath: string;
  agentCount: number;
  tokensSpent: number;
}

// ---------- the globals injected into a workflow script ----------

export type Stage = (prev: unknown, original: unknown, index: number) => unknown;

export interface WorkflowGlobals {
  agent(prompt: string, opts?: AgentOpts): Promise<unknown>;
  parallel(thunks: Array<() => Promise<unknown>>): Promise<unknown[]>;
  pipeline(items: unknown[], ...stages: Stage[]): Promise<unknown[]>;
  log(message: string): void;
  phase(title: string): void;
  args: unknown;
  budget: Budget;
  workflow(nameOrRef: string | { scriptPath: string }, args?: unknown): Promise<unknown>;
}

// ---------- internal run context shared by primitives + runner ----------

export interface RunState {
  /** monotonic invocation ordinal; assigned synchronously at each agent() call (agentId + progress). */
  ordinal: number;
  /** running prefix digest that chains each call's cache key to all calls before it. */
  chain: string;
  agentCount: number;
  tokensSpent: number;
  currentPhase: string;
  agentSeq: number; // for deterministic agentId generation
}

export interface RunContext {
  backend: AgentBackend;
  journal: Journal;
  reporter: ProgressReporter;
  budgetTotal: number | null;
  args: unknown;
  state: RunState;
  defaultModel?: string;
  depth: number; // workflow() nesting; >0 means nested
  limiterRun: <T>(fn: () => Promise<T>) => Promise<T>;
  workflowResolver?: WorkflowResolver;
  worktreeRoot?: string;
  abort: { aborted: boolean };
}
