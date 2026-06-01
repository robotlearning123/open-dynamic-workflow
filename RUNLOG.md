# RUNLOG — how this reproduction was built (process log)

Goal-driven, evidence-first loop: **use the real Workflow tool to monitor / test / log / analyze /
verify** Claude Code dynamic workflows until fully understood, then reproduce 1:1. No claims from
memory — everything below is backed by an artifact in `traces/`. See `docs/goals/reproduce-dynamic-workflows.md`
for the measurable criteria (C1–C10).

## Method
Instead of reading the blog and guessing, we **ran the real system** with instrumented probe
scripts and harvested its transcript directory (the "real working log": `journal.jsonl` +
per-subagent `agent-<id>.jsonl`). `tools/harvest_trace.py` turns raw transcripts into
machine + human digests. Conclusions live in `ANALYSIS.md`, each citing a trace file.

## Timeline

### Phase 0 — grounding
- Fetched the official blog (concepts only, no code). Verified the Anthropic SDK Messages/tool-use
  shape via context7 (`/anthropics/anthropic-sdk-typescript`). Verified dep versions via `npm view`.
- Wrote `docs/goals/reproduce-dynamic-workflows.md` with criteria C1–C10 + verification commands + baseline.

### Phase 1 — capture (4 real runs, all via the Workflow tool)
| exp | run id | what we learned | artifact |
|----|--------|-----------------|----------|
| 01 probe | `wf_69d4a9ee-399` | primitives; parallel barrier+order; pipeline no-barrier; schema=StructuredOutput tool; journal 2-event/v2-key; budget=output tokens; subagent is a full CC agent; model aliases | `traces/experiment-01/` |
| 02 resume | (resume of 01) | **cache key = hash(prompt+opts+ordinal)** (initial model; corrected to prefix-chained in exp-06 — see Phase 4); sequential→100% hit, concurrent→partial+cascade | `traces/experiment-02-resume/FINDING-resume-semantics.md` |
| 03 concurrency | `wf_877f036c-f7f` | **cap = min(16,cores-2)=16**; 30 agents ran in 2 waves (16 then 14) | `traces/experiment-03-concurrency/` |
| 04 sandbox | `wf_a230b6ea-be1` | exact blocked globals + error messages (`Date.now`/argless `new Date`/`Math.random`); `new Date(arg)` ok; no require/process/fetch | `traces/experiment-04-sandbox/` |

Key surprises (only findable by running it):
1. Resume is **not** 100% cache-hit once `parallel`/`pipeline` are used — completion-order
   nondeterminism shifts downstream invocation-ordinals → new keys → partial re-run + cascade.
2. The subagent is the **full** Claude Code agent (one probe shelled out with `Bash` + filesystem
   MCP before answering), not a single LLM call.
3. `budget.spent()` is a **turn-global** output-token meter (main loop + all workflows share it),
   far larger than this run's subagent output.

### Phase 2 — analyze
Wrote `ANALYSIS.md` (every claim cites a trace artifact) and the reproduction blueprint (§10) +
honest fidelity boundaries (§11).

### Phase 3 — reproduce (1:1 engine, TS)
- Opus authored the contract: `src/types.ts` + `SPEC.md` (exact module exports + semantics).
- Build fan-out via the real Workflow tool (`build/build-engine.workflow.js`, run `wf_530e6236-817`):
  parallel Sonnet implementers, one per module (config, concurrency, journal, structured-output,
  backend, primitives, runner, progress/cli/index, examples) + their vitest tests.
- Integration + verification by the orchestrator (npm install, `tsc --noEmit`, `vitest run`,
  `node tools/crosscheck.mjs`). Results recorded below.

### Phase 4 — verify (commands + outputs)
- `npm run typecheck` (`tsc --noEmit`): **PASS** (exit 0).
- `npm test` (`vitest run`): **PASS** — 6 files / 102 tests at this Phase-4 snapshot (now 15 files / 135 tests at HEAD after later phases + the QA-hardening pass).
- `node tools/crosscheck.mjs`: **ALL CHECKS PASSED** (repro journal shape == real).
- `node tools/compare.mjs` (OURS vs CLAUDE): **FIDELITY 34/34 = 100.0%**, stable across repeated runs.
- examples via CLI (`node dist/cli.js examples/*.js --mock`): all 3 run to completion.

A fidelity gap found & fixed during the loop: `parallel()` originally wrapped thunks in try/catch
(swallowed synchronous throws), but the real engine only catches async rejections → null while a
synchronous thunk throw crashes the run (traces/experiment-05). Changed to `t().then(v=>v,()=>null)`
to match, added a test. Also fixed `createJournal` to start a fresh run's journal clean (idempotent
re-runs) — surfaced by the compare harness dropping to 96.3% on a second invocation.

Two later experiments deepened the loop: **experiment-06** distinguished prefix vs content-addressed
resume (edit the 2nd of 4 independent agents → B,C,D re-ran, their keys changed → keys are
**prefix-chained**; refactored to chained-key + content-addressed, journal shape now matches real
exactly). **experiment-07** reproduced the canonical pipeline→parallel composition. Gate grew to **34/34**.

### Phase 5 — live end-to-end (real agent, not mock)
- `node tools/live-e2e.mjs` ran a 2-agent `parallel` through the engine with `CliAgentBackend.claude()`
  → spawned 2 real `claude -p` (haiku) processes → `["ALPHA","BETA"]`. Journal in `traces/e2e-live/`
  shows out-of-order completion (BETA before ALPHA) with input order preserved — real parallel semantics.
- Honesty note: smoke-testing the CLIs first exposed that the **local `codex`** rejects the research-
  reported `--ask-for-approval`/inline `--output-schema`; `CliAgentBackend.codex()` was corrected to the
  verified-local flags. (`ccz` hit a 422 proxy error and `opencode` had no provider configured here.)

## Reproducing the captures yourself
Each probe is a committed plain-JS workflow under `traces/*.workflow.js`. With Claude Code's real
Workflow tool: `Workflow({scriptPath})`; harvest the printed transcript dir with
`python3 tools/harvest_trace.py <run_dir>`.
