# SPEC — module export contract for the 1:1 reproduction

This is the single source of truth for the fan-out implementers. **Implement these exact
exports against `src/types.ts`. Do not change `src/types.ts` or these signatures.** Every
semantic traces to `ANALYSIS.md` §N. ESM TypeScript, `"type":"module"`, NodeNext, strict.

## Verified Anthropic SDK contract (from context7, 2026-05-28 — use verbatim, do NOT invent)
```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey });           // reads ANTHROPIC_API_KEY by default
const msg = await client.messages.create({
  model, max_tokens, system?, messages,             // messages: {role:'user'|'assistant', content: string | block[]}
  tools?, tool_choice?,                              // tool: {name, description, input_schema:{type:'object',properties,required?}}
});                                                  // tool_choice: {type:'tool', name} forces that tool
// msg.content: array of blocks. text: {type:'text',text}. tool_use: {type:'tool_use',id,name,input}
// msg.stop_reason === 'tool_use' when a tool was called. msg.usage = {input_tokens, output_tokens}
```
Structured output = a tool named `StructuredOutput` whose `input_schema` is the user schema, forced via `tool_choice:{type:'tool',name:'StructuredOutput'}`; the returned object is the `tool_use` block's `.input` (ANALYSIS §4).

---

## src/concurrency.ts
```ts
export const MAX_TOTAL_AGENTS = 1000;
export function defaultConcurrency(): number; // min(16, max(1, os.cpus().length - 2))  (ANALYSIS §3.3)
export class Limiter {
  constructor(max: number);
  run<T>(fn: () => Promise<T>): Promise<T>; // acquire slot (queue if full) -> run -> release
  readonly active: number;
  readonly queued: number;
}
```
Tests: ≤max run concurrently (instrument with a counter + delays); excess queue then run; FIFO.

## src/journal.ts
```ts
import type { AgentOpts, Journal, JournalEvent } from "./types.js";
export function chainKey(prevChain: string, prompt: string, opts: AgentOpts): { key: string; chain: string };
// PREFIX-CHAINED (ANALYSIS §6, traces/experiment-06): chain = sha256(prevChain ‖ prompt ‖ stableStringify(
//   {schema,model,agentType,isolation})); key = "v2:"+chain. The advanced `chain` feeds the next call,
//   so editing one call changes every LATER key (cascade) and reordering concurrent calls perturbs the chain.
export function createJournal(o: { runId: string; dir: string; resumeFromRunId?: string }): Journal;
// - writes <dir>/<runId>/journal.jsonl as append-only {type:"started"|"result",key,agentId,result?}
//   (exact real shape — NO ordinal field); a fresh run (resumeFromRunId !== runId) truncates first.
// - resume = CONTENT-ADDRESSED: load prior run's `result` events into Map<key,result>;
//     lookup(key): prior.has(key) ? {hit:true,result} : {hit:false}.  (chained key makes this reproduce
//     sequential=100% / edit=cascade-from-edit / concurrent-reorder=partial — no separate prefix flag)
```
Tests: same (ordinal,key) prefix → hits; first divergence → miss + all later miss; result types preserved (object/string).

## src/structured-output.ts
```ts
import type { JsonSchema } from "./types.js";
export const MAX_SCHEMA_RETRIES = 2;
export function toToolDef(schema: JsonSchema, name?: string): { name: string; description: string; input_schema: JsonSchema };
export function validate(value: unknown, schema: JsonSchema): { ok: true } | { ok: false; errors: string[] };
// supports: type object/array/string/number/integer/boolean/null, properties, required, items, enum
```
Tests: valid passes; missing required fails; wrong type fails; enum enforced; nested object/array.

## src/backend.ts
```ts
import type { AgentBackend, AgentRequest, AgentResponse } from "./types.js";
export class MockBackend implements AgentBackend {
  constructor(o?: { responder?: (req: AgentRequest) => unknown; delayMs?: number });
  run(req: AgentRequest): Promise<AgentResponse>;
  // deterministic (NO Date/random): if schema -> synthesize a minimal VALID instance (object:{} fill required
  //   recursively; string:"mock"; integer/number:0; boolean:false; array:[]; enum:first). else -> echo a canned
  //   string derived from req.prompt. outputTokens = Math.ceil(JSON.stringify(output).length/4). Records calls[].
  readonly calls: AgentRequest[];
}
export class AnthropicBackend implements AgentBackend {
  constructor(o?: { apiKey?: string; defaultModel?: string; maxTokens?: number; client?: any; aliases?: Record<string,string> });
  run(req: AgentRequest): Promise<AgentResponse>;
  // resolve model alias (sonnet->claude-sonnet-4-6, haiku->claude-haiku-4-5-20251001 [ANALYSIS §8]; opus->claude-opus-4-6 by naming convention — not observed in traces);
  // schema: tools=[StructuredOutput], tool_choice forced -> parse .input -> validate -> retry up to MAX_SCHEMA_RETRIES;
  // no schema: read text blocks. outputTokens from msg.usage.output_tokens.
}
```
Tests (MockBackend only — no network): schema → valid object; text → string; outputTokens>0; deterministic across calls.

## src/primitives.ts
```ts
import type { RunContext, RunConfig, WorkflowGlobals, Budget } from "./types.js";
export function createContext(cfg: RunConfig & { runId: string }): RunContext;
export function makeGlobals(ctx: RunContext): WorkflowGlobals;
```
Semantics (ANALYSIS §2,3,6,7):
- `agent(prompt,opts)`: synchronous BEFORE any await → `const ordinal = ++ctx.state.ordinal`; resolve label/phase;
  `const {key,chain} = chainKey(ctx.state.chain, prompt, opts); ctx.state.chain = chain;` `agentId` from ordinal;
  `const cached = journal.lookup(key)` **before** limiterRun — so a fully-cached resume bypasses the concurrency slot entirely;
  if hit → emit agent-start(cached:true) + agent-done(cached:true), return cached result;
  else emit agent-start(cached:false); then `ctx.limiterRun(async()=>{`
  enforce budget ceiling (`budgetTotal!=null && tokensSpent>=budgetTotal` → throw) and `agentCount>=MAX_TOTAL_AGENTS` → throw;
  `journal.recordStarted`; `resp = await backend.run({prompt,schema,model,agentType,agentId})`; `agentCount++`;
  `tokensSpent += resp.outputTokens`; `journal.recordResult`; emit agent-done; return resp.output; on throw → emit agent-fail, rethrow `})`.
- `parallel(thunks)`: `Promise.all(thunks.map(t => t().then((v) => v, () => null)))` — barrier, order preserved; an async rejection → `null`, but a **synchronous** throw in `t()` propagates and crashes the run (matches the real engine; traces/experiment-05). Must match `src/primitives.ts`.
- `pipeline(items,...stages)`: per item independent chain; `let acc=item; for(stage of stages) acc=await stage(acc,item,i); return acc;` wrapped in try/catch→null; all chains via `Promise.all`. NO inter-stage barrier.
- `phase(title)`: set `ctx.state.currentPhase=title`; emit phase.
- `log(msg)`: emit log.
- `budget`: `{total: ctx.budgetTotal, spent:()=>ctx.state.tokensSpent, remaining:()=> total==null?Infinity:Math.max(0,total-spent())}`.
- `workflow(ref,args)`: if `ctx.depth>=1` throw "nesting one level only"; resolve script via ctx.workflowResolver; run nested with depth+1 sharing the SAME ctx counters/journal/limiter/budget.

Tests: parallel order+null; pipeline no-barrier (interleave via delayed mock + record start order) + stage args; budget ceiling throws; resume hit returns cached w/o backend call.

## src/runner.ts
```ts
import type { Meta, RunConfig, RunResult } from "./types.js";
export function parseMeta(source: string): Meta;          // extract `export const meta = {...}` literal; require name+description
export function runWorkflow(source: string, cfg: RunConfig): Promise<RunResult>;
export function runWorkflowFile(path: string, cfg: RunConfig): Promise<RunResult>;
```
Sandbox (ANALYSIS §9): run body via `node:vm`. Strip leading `export ` so the source becomes a function body; wrap as
`(async function(){ <body> })` in a `vm.createContext` whose globals = injected workflow globals + safe built-ins
(`JSON, Math, Array, Object, String, Number, Boolean, Promise, Map, Set, console, globalThis`). Provide a `Date` whose
`now()` and **argless** constructor THROW the exact message from ANALYSIS §9 but `new Date(arg)` works; `Math` is Math with
`random` throwing the exact §9 message. Do NOT expose require/process/fetch (leave undefined). Generate `runId` if absent
(NO Date/random — derive from a counter/hash of source+args or accept cfg.runId; CLI passes one).

## src/progress.ts / src/cli.ts / src/index.ts
- `progress.ts`: `export class TreeReporter implements ProgressReporter { constructor(o?:{stream?:NodeJS.WritableStream}); emit(e){...} }` + `export const silentReporter: ProgressReporter`. Render phases as groups, agents as leaves (label, cached?, tokens), log as narrator lines, to stderr.
- `cli.ts`: shebang; parse `run-workflow <script.js> [--args <json>] [--resume <runId>] [--mock] [--budget <n>] [--json-dir <dir>]`. Pick `AnthropicBackend` if `ANTHROPIC_API_KEY` and not `--mock`, else `MockBackend`. Print runId + JSON result. Nonzero exit on error.
- `index.ts`: re-export public API: runWorkflow, runWorkflowFile, parseMeta, MockBackend, AnthropicBackend, CliAgentBackend, HttpAgentBackend, Limiter, createJournal, chainKey, withWorktree, TreeReporter, silentReporter, and all types.

## examples/ (plain JS, use injected globals; runnable with --mock)
- `review-changes.js` — DIMENSIONS → `pipeline(review, verify)` → filter confirmed. Include `survivesVerification(votes)` helper (majority) — flag as a tunable decision point in a comment.
- `research.js` — `parallel` multi-modal sweep → `pipeline` deep-read → synth.
- `loop-until-dry.js` — find/dedup(`key(f)`)/judge loop until 2 dry rounds (must terminate under MockBackend).
