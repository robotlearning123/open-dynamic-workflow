# ANALYSIS — How Claude Code "dynamic workflows" actually work (empirical)

> Method: we ran the **real** Workflow tool seven times with instrumented probe scripts,
> harvested the transcript directory (the real working log), and parsed it. Every claim
> below cites the trace artifact that proves it. Nothing here is from memory.

## Sources of truth
- **Blog** (concepts): https://claude.com/blog/introducing-dynamic-workflows-in-claude-code — *"Claude dynamically writes orchestration scripts that run tens to hundreds of parallel subagents in a single session, checking its work before anything reaches you."* (fetched 2026-05-28; no code in the post).
- **Real working logs** (ground truth): `traces/experiment-01..07/` — raw `journal.jsonl` + `agent-<id>.jsonl` + `*.meta.json` + `task-output.json`, plus `parsed/` digests from `tools/harvest_trace.py`.
- **Anthropic SDK** shape: context7 `/anthropics/anthropic-sdk-typescript` (fetched 2026-05-28).

## Experiment index
| exp | script | what it isolates | agents |
|----|--------|------------------|--------|
| 01 | `experiment-01-probe.workflow.js` | all primitives, parallel/pipeline, schema, budget | 8 |
| 02 | (resume of 01) | resume / cache-key semantics | +3 re-run |
| 03 | `experiment-03-concurrency.workflow.js` | concurrency cap | 30 |
| 04 | `experiment-04-sandbox.workflow.js` | script sandbox globals | 0 |
| 05 | `experiment-05-boundaries/parent.workflow.js` | nesting depth + parallel/pipeline edge cases | 1 |
| 06 | `experiment-06-resume-model.workflow.js` | resume model: prefix vs content-addressed (chained key) | 4 (+3 on resume) |
| 07 | `experiment-07-compose.workflow.js` | composition: pipeline stage-2 = parallel (canonical review→verify) | 6 |

---

## 1. What a dynamic workflow is
A workflow is a **plain-JS orchestration script** (begins with `export const meta = {...}`) executed in a sandbox with injected globals (`agent, parallel, pipeline, phase, log, args, budget, workflow`). The script body runs in an async context and may `return` a value. Each `agent()` call spawns a **real Claude Code subagent**; the engine schedules them under a concurrency cap and journals every call so the run can resume.

## 2. The primitives
| primitive | signature | observed semantics |
|---|---|---|
| `agent` | `(prompt, opts?) => Promise<any>` | spawns one subagent; returns its structured object (if `opts.schema`) or final text |
| `parallel` | `(thunks[]) => Promise<any[]>` | runs thunks concurrently; **barrier** (awaits all); **preserves input order**; failed thunk → `null` |
| `pipeline` | `(items, ...stages) => Promise<any[]>` | each item through all stages independently; **NO inter-stage barrier**; stage gets `(prev, original, index)`; failed stage → that item `null`, skips rest |
| `phase` | `(title) => void` | starts a progress group |
| `log` | `(message) => void` | narrator line |
| `budget` | `{total, spent(), remaining()}` | turn-global output-token meter; hard ceiling |
| `workflow` | `(nameOrRef, args?) => Promise<any>` | run another workflow inline (nesting one level) |

`opts`: `{label, phase, schema, model, isolation, agentType}` — all observed in `traces/experiment-01/parsed/digest.md`.

## 3. Execution model

### 3.1 `parallel()` = concurrent + barrier + order-preserving
Evidence `traces/experiment-01/parsed/digest.md` (Concurrency table): the 3 fanout agents started at `18:57:32.142 / .143 / .144` — within **2 ms** → concurrent. The next phase (pipeline) did not start until `18:57:53.015`, i.e. **after** the slowest fanout agent ended (`18:57:50.946`, an 18.8 s straggler) → **barrier**. Order: `task-output.json` reports `fanoutOrderPreserved:true` (script self-check `fan.every((r,i)=>r.id===i)`), and journal results carry ids 0,1,2 in array order though completion order was 0,2,1.

### 3.2 `pipeline()` = NO inter-stage barrier
Evidence (two independent proofs):
- **Journal order** `traces/experiment-01/run/journal.jsonl`: line 9 = item *no-barrier* stage-1 result; line 10 = its stage-2 `started`; line 11 = item *stage-semantics* stage-1 result. So item B was already in stage-2 while item A was still in stage-1.
- **Wall-clock** `.../digest.md`: item *no-barrier* stage-2 (`ab8495`) started `18:57:57.010`, **before** item *stage-semantics* stage-1 (`a3430`) ended `18:57:58.066`.
- Stage callback args confirmed: stage-2 text says *"Received stage-1 id=0 … for originalItem=\"stage-semantics\""* → it received `(prevResult, originalItem, index)`; and stage-1's `prev` equals the item itself.

### 3.3 Concurrency cap = `min(16, cores-2)`
Evidence `traces/experiment-03-concurrency/`: 30 parallel agents; sweep-line over `[start,end]` intervals gives **MAX CONCURRENT = 16** (host has 32 cores → `min(16,30)=16`). Start offsets cluster into **two waves**: 16 agents at `0.00–0.01 s`, the remaining 14 at `4.25–6.13 s` (after wave-1 slots freed). Excess calls queue.

## 4. Structured output → a forced `StructuredOutput` tool
Evidence `traces/experiment-01/run/agent-a121115b7b37b5c30.jsonl` (a schema agent, 5 events): `user`(prompt) → 2×`attachment` → `assistant` with a single **`tool_use` block named `StructuredOutput`** → `user` `tool_result`. The tool's `input` *is* the returned object and equals the journal `result` (`result_matches_journal: True`). Agents **without** `schema` emit a final text block and `tools: []`. So: `schema` ⇒ register a tool `StructuredOutput` whose `input_schema` is the user schema, force `tool_choice`, read `.input`.

## 5. Journal format (append-only, 2-event)
`traces/experiment-01/run/journal.jsonl` — one JSON object per line:
```
{"type":"started","key":"v2:<sha256hex>","agentId":"<id>"}
{"type":"result", "key":"v2:<sha256hex>","agentId":"<id>","result": <object|string>}
```
- `result` is an **object** when a schema was used, a **string** otherwise.
- per-agent files `agent-<id>.jsonl` hold the full subagent transcript; `agent-<id>.meta.json` = `{"agentType":"workflow-subagent"}`.

## 6. Resume / cache-key semantics (the key finding)
Full write-up + prompt diff: `traces/experiment-02-resume/FINDING-resume-semantics.md`.
- Re-running the **identical** script+args was **not** a 100 % cache hit: 5 agents HIT (3 `parallel` + 2 pipeline stage-1), **3 MISSED** (2 pipeline stage-2 + synth) and re-ran with **new `v2` keys**.
- Decisive measurement: pipeline stage-2's prompt was **byte-identical** across runs (260==260) yet got a new key ⇒ the key is **not** `hash(prompt+opts)` alone; it carries an **invocation-ordinal**.
- Mechanism (**refined by experiment-06**): the key is **prefix-CHAINED** — `key_n = v2:hash(chain_{n-1} ‖ prompt_n ‖ opts_n)`, where `chain` advances at each `agent()` invocation. experiment-06 proved this directly: editing the 2nd of **4 independent sequential** agents changed not only B's key but **C's and D's keys too** (their prompts were identical!) → B, C, D all re-ran while A (before the edit) was cached. So a single change **cascades** to every later call (prefix semantics), and a concurrent **reorder** perturbs the chain from that point on (the exp-02 partial hit, re-explained). Earlier "+invocation-ordinal" framing was the special case; the chain subsumes it.
- ⇒ The doc's *"same script+args → 100 % cache hit"* holds for **deterministic invocation order** only. An **edit** re-runs that call and everything after it (chained cascade); `parallel`/`pipeline` **completion-order nondeterminism** likewise perturbs the chain → partial hit. Reproduced 1:1 in `src/journal.ts` (`chainKey`) + asserted by `tools/compare.mjs` ("resume cascade").

## 7. Budget = turn-global OUTPUT-token meter
`traces/experiment-01/task-output.json`: `budgetTotal:null`, `tokensSpent:56533`. The real Workflow tool's session-level turn usage (reported in-product, **not** persisted in this committed artifact) was far larger than this `tokensSpent` value — so `budget.spent()` counts **output** tokens only, and it is a **turn-global shared pool** (main loop + all workflows), far larger than this run's subagent output alone. `total:null` ⇒ `remaining()===Infinity`. Ceiling is a hard stop (`agent()` throws when spent ≥ total) — documented; not triggerable here without a budget directive (reproduced + unit-tested in the engine instead).

## 8. The subagent is a full Claude Code agent
`traces/experiment-01/parsed/digest.md` agent `ab93…` used `tools: ['Bash','Bash','mcp__filesystem__list_directory'×2,'read_text_file','StructuredOutput']` over 18 events / 18.8 s — it actually shelled out and read files before answering. The two `attachment`s injected into every subagent are a `deferred_tools_delta` (tool list) and a `skill_listing`; their raw payloads (a private, user-specific skill list) are **stripped from the committed traces for privacy**. Default `agentType = "workflow-subagent"`. Model aliases resolve: `sonnet → claude-sonnet-4-6`, `haiku → claude-haiku-4-5-20251001`.

## 9. Script sandbox (exact contract)
`traces/experiment-04-sandbox/task-output.json`:
- `Date.now()` and argless `new Date()` **throw**: *"Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args."*
- `new Date(0)` **works** (only the argless form is blocked).
- `Math.random()` **throws**: *"Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt."* — `Math.floor` etc. work.
- `require`, `process`, `fetch` ⇒ `undefined` (no Node/web APIs); `globalThis` ⇒ object; injected `agent/parallel/pipeline/budget` present.
- **Security caveat (ours):** reproducing this via `node:vm` matches the observable API shape but is **not** a security boundary — injected host built-ins expose the host `Function` via `.constructor`, so workflow source must be **trusted** (as in the real engine, where Claude authors it). See `SECURITY.md`.

## 10. Reproduction blueprint (what the engine must implement)
1. **Runner**: parse `export const meta`; run the body in a `vm` sandbox with injected globals + safe built-ins; shadow `Date.now`/argless `Date`/`Math.random` to throw the **exact** messages above; allow `new Date(arg)`; support top-level `return` and `await`.
2. **Scheduler**: concurrency limiter cap `min(16, cores-2)`; lifetime cap 1000.
3. **`parallel`**: `Promise.all` of order-preserving slots; per-thunk catch → `null`.
4. **`pipeline`**: per-item independent chains (no inter-stage barrier); per-item catch → `null`, skip remaining stages; stage args `(prev, original, index)`, stage-1 `prev = item`.
5. **`agent`**: assign synchronous **ordinal**; `key = v2:sha256(prompt|opts|ordinal)`; journal `started`; on resume `lookup(ordinal,key)`; else `backend.run` (StructuredOutput forced tool when `schema`, else text); journal `result`; add `outputTokens` to budget; enforce ceiling + lifetime cap.
6. **Journal**: append-only `started`/`result` JSONL; resume replays the longest intact `(ordinal,key)` prefix.
7. **Backend**: `AnthropicBackend` (verified SDK shape) + `MockBackend` (deterministic, schema-faking) for offline tests/cross-check.
8. **Budget**: monotonic output-token meter; `remaining()` Infinity when `total` null.

## 11. Known fidelity boundaries (honest)
- We reproduce the **observable behavior**, not the byte-identical `v2` hash (its internal preimage is not observable). Cross-check asserts shape/semantics, not equal hashes.
- The real subagent is the full Claude Code agent (Bash, filesystem, skills). A standalone library reproduces the **orchestration layer 1:1**; the subagent is modeled as a Claude API call that may use tools + the `StructuredOutput` tool. (`AnthropicBackend` can pass a toolset, but does not embed Claude Code itself.)
- `budget.spent()` is **turn-global** in the harness; in the standalone engine it is **run-scoped** (sum of agent output tokens). Same observable contract (monotonic meter + hard ceiling), narrower scope — documented.
- Invocation-ordinal vs start-ordinal can't be disambiguated at ≤3 concurrent; we use invocation order (deterministic), which reproduces the observed hit/miss pattern.

## 12. Limits & edge-case boundaries (Wave C — traces/experiment-05)
| boundary | observed behavior | evidence |
|---|---|---|
| `parallel([])` / `pipeline([], …)` | return `[]` | exp-05 result |
| `parallel` thunk **async rejection** (e.g. agent error) | becomes `null` in the array (logged as a failure) | exp-05 `asyncRejectParallel_nullAt1:true` + `<failures>` |
| `parallel` thunk **synchronous throw** | **crashes the whole run** (NOT caught → not null) | exp-05 run `wf_faf90a80-d85` `failed: Error: boom-thunk` |
| `pipeline` **stage throw** (sync) | that item → `null`, remaining stages skipped, other items proceed | exp-05 `throwingPipeline:[null,"b-done"]` |
| `workflow()` **nesting depth** | exactly **1 level**: a top workflow may call `workflow()`, but a *child* calling `workflow()` throws | exp-05 `parentLevelError:null`, `childResult.nestedError` |
| nesting error message (exact) | *"workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly."* | exp-05 |
| **concurrency cap** | `min(16, cores-2)` (=16 here); excess queue in waves | exp-03 |
| **agent lifetime cap** | 1000 total agents per run (documented hard limit; reproduced as `MAX_TOTAL_AGENTS` + enforced/unit-tested; a live 1000-agent confirmation was not run to bound cost) | S7 + engine test |

The asymmetry (parallel crashes on a sync throw, pipeline does not) is consistent with the impls:
`parallel` calls `t()` directly in `.map` (a sync throw escapes), while `pipeline` calls each stage
inside an async per-item chain (a sync throw is contained as that chain's rejection → `null`). The
reproduction matches both (see `src/primitives.ts` + `tools/compare.mjs` 100% fidelity).

## 13. Reconciliation with official docs (verified 2026-05-28; URLs in PROVENANCE S9)
- **Concurrency cap**: official [workflows doc](https://code.claude.com/docs/en/workflows) says **16 (fewer on limited CPU)** — it does NOT publish a `cores-2` term. Our `min(16, cores-2)` comes from the in-product tool reference (S7) + our measurement (16 on 32 cores); treat `-2` as source-specific, not a public-doc fact.
- **Lifetime cap = 1000** and **trigger by the "workflow" keyword / `ultracode` (no `--workflow` flag)**: confirmed official.
- **Resume scope**: official resume is **same-session only** (next session starts fresh). Our journal-based, cross-session prefix-replay is therefore a **superset**, not 1:1 on that axis — stated plainly.
- **Script API names** (`agent/parallel/pipeline/phase/log/budget/workflow`): **not published** in public docs. We obtained them by *running the real tool* (execution-verified, see traces/) + the in-product tool reference; we reproduce observed behavior and do not claim them as Anthropic-published primitives.
- **Cloud counterpart**: the [Managed Agents API](https://platform.claude.com/docs/en/managed-agents/multi-agent.md) is Anthropic's hosted multi-agent product — coordinator + roster, **25 concurrent threads**, **depth-1 delegation** (corroborates our `workflow()` 1-level nesting), `type:"self"`. It maps to our `HttpAgentBackend` (local→cloud).
- **Official corroboration of our directions**: subagent frontmatter includes `isolation: worktree` (v2.1.143+) and agent-teams run in git worktrees — exactly the isolation we implemented in `src/worktree.ts`.

Full competitive landscape: `docs/COMPARISON.md`.
