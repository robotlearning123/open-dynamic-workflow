# I reverse-engineered Claude Code's "dynamic workflows" by running them 7 times — here's everything I found

*2026-05-28 · a complete teardown + an open, vendor-neutral 1:1 reproduction*

Anthropic shipped [**dynamic workflows**](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) in Claude Code: Claude writes a JavaScript orchestration script that fans out *tens to hundreds of parallel subagents in one session, checking its work before anything reaches you.* The announcement is concept-only — **no API, no function names, no journal format**. The official docs ([code.claude.com/docs/en/workflows](https://code.claude.com/docs/en/workflows)) confirm the constraints but still don't publish the script API.

So instead of guessing from the blog, I did the empirical thing: **I ran the real tool, captured its logs, analyzed them, and reproduced the observed behavior** — until a differential gate scored **34/34 = 100%** against the captured traces. The result is [`open-dynamic-workflow`](https://github.com/robotlearning123/open-dynamic-workflow): an open TypeScript engine you can run *outside* Claude Code, whose basic unit is a **pluggable real agent** (Claude Code, Codex, OpenCode, or a cloud runner).

This post is the full teardown: the method, every surprising finding (with the experiment that proved it), the reproduction, and an honest accounting of where it does and doesn't match.

---

## The method: run → harvest → analyze → reproduce → diff to a fixpoint

```
blog (concepts) + REAL working logs (7 instrumented runs)  →  ANALYSIS.md  →  src/  →  compare.mjs = 34/34 (100%)
       S1                     S2…S8                              reasoning      engine     OURS vs CLAUDE
```

Every run is a tiny **probe**: a workflow script written to *exercise one behavior and reveal it in the logs*. Claude Code persists each run's script and writes an append-only `journal.jsonl` plus a full transcript per subagent. I harvested those, parsed them (`tools/harvest_trace.py`), and turned each observation into an assertion in `tools/compare.mjs` that re-checks our engine against the captured truth. When a probe disagreed with my implementation, the implementation was wrong — and I fixed it. (That happened twice; both are below.)

No claim in the repo is from memory: the Anthropic SDK shape, the CLI flags, even competitor star counts are all source-cited, and anything I couldn't verify is marked as such.

---

## What I found (each backed by a probe)

| # | Behavior | What the logs showed |
|---|----------|----------------------|
| 1 | **`parallel()` = concurrent + barrier + order-preserving** | 3 agents started within **2 ms**; the next phase waited for the 18.8 s straggler before starting. Results came back in input order even though completion order was 0,2,1. |
| 2 | **`pipeline()` has no inter-stage barrier** | Item *B*'s stage-2 started at `57.010s`, **before** item *A*'s stage-1 ended at `58.066s` — proven on the wall clock, not just by log order. |
| 3 | **The subagent is a *full Claude Code agent*** | One probe shelled out with `Bash` + filesystem MCP **before** answering. The unit isn't an LLM call — it's an agent with tools. |
| 4 | **Concurrency cap = `min(16, cores-2)`** | 30 parallel agents → a sweep line over their start/stop timestamps peaked at exactly **16**; the other 14 started only after slots freed (two clean waves). |
| 5 | **The script sandbox blocks time/randomness** | `Date.now()`, argless `new Date()`, and `Math.random()` throw *exact* messages ("…unavailable in workflow scripts (breaks resume)…"); `new Date(0)` works; `require`/`process`/`fetch` are `undefined`. |
| 6 | **`budget.spent()` is a turn-global OUTPUT-token meter** | `budget.total` was `null` (no target); `spent()` = 56 533 *output* tokens — far below the session's true total token use — so it counts output only, shared across the whole turn. |
| 7 | **`workflow()` nesting is exactly one level** | A child calling `workflow()` threw a precise message ("…nesting is limited to one level. Inline the inner script or call its agents directly."). |

And the two that **corrected my implementation**:

### Finding 8 — `parallel` crashes on a *synchronous* throw

The docs say a throwing thunk "resolves to `null`." My first probe put a synchronous `throw` in a thunk — and the **whole workflow crashed** (`failed: Error: boom-thunk`). Only **async** rejections become `null`; a synchronous throw escapes. The faithful implementation is `Promise.all(thunks.map(t => t().then(v => v, () => null)))` — a sync throw in `t()` escapes the `.map` before `.then` can catch it. (`pipeline` *does* swallow it, because each stage runs inside an async per-item chain. The asymmetry is real.)

### Finding 9 — resume is **prefix-chained**, and "100% cache hit" is conditional

The docs promise *"same script + args → 100% cache hit."* My first resume probe (with `parallel`/`pipeline`) showed only a **partial** hit. To find out *why*, I built the decisive experiment: **4 independent, sequential agents A→B→C→D, then edit only B and resume.**

- A **prefix** model predicts B, C, D all re-run.
- A **content-addressed** model predicts only B re-runs (C, D have identical prompts).

The result: **B, C, *and* D re-ran; A was cached** — and crucially, **C's and D's cache keys had changed even though their prompts were byte-identical.** That can only mean the cache key is **prefix-chained**: `key_n = v2:hash(chain_{n-1} ‖ prompt_n ‖ opts_n)`. Editing B perturbs the chain for everything after it. The same mechanism explains the concurrent partial-hit (a reorder perturbs the chain from that point) and the doc's "100% for sequential" (a deterministic chain → identical keys).

My v1 used `hash(prompt+opts+ordinal)` plus a separate "prefix-intact" flag — it reproduced the *behavior* but produced the *wrong key values*. I refactored to a chained key + content-addressed lookup, which is simpler, matches the real journal shape exactly (`{type,key,agentId,result}` — I'd been carrying an extra `ordinal` field), and reproduces all of it. **You only catch this by designing an experiment that distinguishes the two hypotheses.**

---

## How it actually works — the mechanism

Strip away the findings and the engine is small. A "dynamic workflow" is **a plain-JS script Claude writes**; the engine is **a runtime that executes that script and turns every `agent()` call into a real, scheduled, *resumable* subagent.** Five mechanisms do all the work.

**1 — The script is data, executed in a sandbox.** The orchestration script runs inside a `node:vm` context whose only globals are the injected primitives (`agent / parallel / pipeline / phase / log / budget / workflow`) plus a few safe built-ins. `Date.now()`, argless `new Date()`, and `Math.random()` are replaced with throwing stubs — **not for security, but for determinism**: resume (below) hashes each call's inputs, so a live clock or RNG would change the keys on replay. (The vm is *not* a security boundary; run only trusted scripts.)

**2 — `agent()` is the atom.** Every call does the same thing, claiming its place in line *synchronously, before any `await`*, so ordering is deterministic:

```js
ordinal = ++state.ordinal                          // deterministic position in the run
{key, chain} = chainKey(state.chain, prompt, opts) // prefix-chained content hash (see #3)
state.chain = chain                                // advance the chain for the next call

if (journal.lookup(key).hit) return cached         // RESUME: skip the backend AND the limiter

await limiter.run(async () => {                    // concurrency gate: min(16, cores-2) live agents
  budgetCeilingCheck()                             // best-effort output-token ceiling
  journal.recordStarted(key, agentId)
  resp = await backend.run({ prompt, schema, model, agentId })  // ← the REAL agent runs here
  state.tokensSpent += resp.outputTokens
  journal.recordResult(key, agentId, resp.output)  // append-only result event
  return resp.output
})
```

**3 — Resume is an append-only journal keyed by a *prefix-chained* hash.** Each live call appends `{started}` then `{result, key}` to `journal.jsonl`. Re-run the script and every key is recomputed; a match returns the stored result **without calling the backend**. The key isn't `hash(prompt)` — it's **`v2:hash(chain_{n-1} ‖ prompt_n ‖ opts_n)`**, a running hash over *every prior call*. That one decision explains all of Finding 9: edit a call and every *later* key changes (cascade); reorder concurrent calls and the chain diverges from that point (partial hit); keep the order deterministic and you get the promised 100% hit. It is also exactly *why* mechanism #1 must kill the clock and the RNG.

**4 — `parallel` / `pipeline` are just fan-out over `agent()`; the *limiter* does the scheduling.** `parallel(thunks)` is `Promise.all` with a barrier (order preserved; async reject → `null`; sync throw propagates — Finding 8). `pipeline(items, …stages)` runs each item through all stages in its own async chain with **no inter-stage barrier** (Finding 2). Neither schedules anything itself — a single semaphore (the **limiter**) caps live agents at `min(16, cores-2)`, so 30 `agent()` calls drain in two waves (Finding 4).

**5 — The unit is pluggable.** `backend.run(...)` is the *only* line that touches a real agent — so the "agent" can be a deterministic mock, a Claude API call, a **real `claude -p` / Codex / OpenCode process**, or a remote HTTP runner. Every mechanism above is identical regardless of backend; only the unit changes. That is the entire basis for *"the basic unit is any agent."*

The upshot: **orchestration = a sandboxed script + a content-addressed journal + a concurrency semaphore + a swappable agent unit.** The 1:1 fidelity, cross-session resume, and mixed local/cloud fleets all fall out of those four pieces.

---

## The reproduction

`open-dynamic-workflow` is a ~1k-line TypeScript engine that runs plain-JS workflow scripts in a `node:vm` sandbox with the injected globals `agent / parallel / pipeline / phase / log / budget / workflow`. It reproduces, and gates in CI, all of the above:

```js
import { runWorkflowFile, CliAgentBackend } from "open-dynamic-workflow";

// the canonical "review -> verify each finding" shape, on real agents:
await runWorkflowFile("examples/review-changes.js", {
  backend: CliAgentBackend.claude({ model: "claude-haiku-4-5-20251001" }),
});
```

The differential gate (`node tools/compare.mjs`) runs the *same probe scripts* through our engine and asserts behavior against the captured traces — sandbox (14 exact-message checks), boundaries, journal shape, resume cascade, parallel order, pipeline `(prev,original,index)`, concurrency cap, budget, and the pipeline→parallel composition: **34/34 = 100%**, plus 135 unit tests, enforced by GitHub Actions.

### The twist: the basic unit is a pluggable real agent

Claude's subagent *is* Claude Code. Ours is **any** agent, by swapping the backend:

| backend | the agent unit | scope |
|---|---|---|
| `MockBackend` | synthesized, deterministic | offline tests / the fidelity gate |
| `AnthropicBackend` | a Claude API call + tool-use loop | direct API |
| `CliAgentBackend` | a **real local agent process** — `.claude()` / `.codex()` / `.opencode()` / `.worker('ccz')` | local fleets |
| `HttpAgentBackend` | a **remote agent** over HTTP | cloud runners |

This means a single orchestration can fan out a **mixed fleet** — Claude Code for hard reasoning, Codex/OpenCode for edits, a free local worker for grunt work — something the closed, Claude-only, in-session engine can't do.

### Live-verified (not just mock)

The headline claim deserves a real run, so here's one — our engine driving two real `claude -p` agents in parallel:

```
$ node tools/live-e2e.mjs
[phase] Fanout
  [Fanout] #1 a001-1 "alpha" starting...
  [Fanout] #2 a002-2 "beta" starting...
  [Fanout] #2 a002-2 "beta" done
  [Fanout] #1 a001-1 "alpha" done
result: {"results":["ALPHA","BETA"]}
LIVE E2E OK ✓ — engine drove real Claude Code agents end-to-end
```

(Building this honestly also surfaced a bug: my `CliAgentBackend.codex()` preset used flags from one Codex version that the *locally installed* Codex rejected — caught by smoke-testing the CLI before trusting it, then fixed to the verified-local flags. Distrust the SDK/CLI field you didn't run.)

---

## Where it sits vs the field

- **vs raw Claude dynamic workflows:** most capable but closed, in-session, single-vendor, same-session-only resume. We match the orchestration 1:1, the unit can *be* Claude Code, and we add multi-vendor + cloud + cross-session journal resume. Raw still wins on UX/IDE integration and battle-tested scale.
- **vs LangGraph / CrewAI / AutoGen / Mastra / OpenAI Agents SDK:** their unit is an LLM call; ours is a real agent process. None verify behavioral fidelity to a real engine.
- **vs claude-flow / claude-squad / wanman / OpenCode+oh-my-opencode:** swarms, TUIs, substrates, and single-host plugins. We're the vendor-neutral *conductor* that can drive them as backends.

Full matrix + sources: [`docs/COMPARISON.md`](../COMPARISON.md) and [`docs/PARITY.md`](../PARITY.md).

---

## Honest boundaries

This reproduces **observable behavior**, not Anthropic's internals. The `v2:` hash *preimage* is undisclosed — we match shape and semantics, not bytes. `budget` is run-scoped here vs turn-global in the harness. CLI agents don't report tokens, so we estimate. And official resume is same-session-only; our journal-based cross-session replay is a deliberate superset. It is still a v0.x project: new, and not yet battle-tested at scale.

## Try it

```bash
git clone https://github.com/robotlearning123/open-dynamic-workflow && cd open-dynamic-workflow
npm install && npm run build
npm test && npm run compare      # 239 tests + 34/34 fidelity
node dist/cli.js examples/review-changes.js --mock   # offline, deterministic
```

The raw traces, the analysis, the experiments, and the engine are all in the repo. If you want to understand how Claude's dynamic workflows actually behave — or orchestrate your own fleet of real agents — start with [`ANALYSIS.md`](../../ANALYSIS.md) and [`RUNLOG.md`](../../RUNLOG.md).

*"Claude" and "Claude Code" are Anthropic's; this is an independent, educational reproduction.*
