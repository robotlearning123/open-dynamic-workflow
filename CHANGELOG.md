# Changelog

All notable changes to this project are documented here (format: [Keep a Changelog](https://keepachangelog.com/)).

## [0.0.7] - 2026-06-01
Release-readiness hardening for public/open-source distribution.

### Fixed
- `parseMeta()` now ignores `export const meta =` text inside regex literals before selecting the real metadata export.
- Public GitHub CI uses GitHub-hosted `ubuntu-latest` runners.
- Current benchmark docs use placeholder key names instead of account labels or API-key prefixes.
- Tracked helper/probe scripts no longer hardcode machine-local repository paths.
- The `ccfree-flash` fleet-matrix worker now passes the same prompt/sandbox flags as the other cc-family wrappers.
- Added `npm run release:export -- <dir>` to create a clean fresh-repo seed from the sanitized current tree.

### Changed
- Npm package contents now include the public docs needed by README links while excluding local review, build, and trace artifacts.
- Release status now distinguishes current-tree cleanup from the remaining full-history cleanup required before making the existing private GitHub repository public.

## [0.0.6] - 2026-05-29
Pool **Phase 3** — the agentic control plane (opt-in). An out-of-band manager reads the scheduler's live telemetry and **re-authors** the pool config; the deterministic data plane (v0.0.5) is unchanged. Engine still untouched; **34/34** fidelity + crosscheck green; **233 tests**.

### Added
- **`src/pool-manager.ts`**: `poolTelemetry(state)` (per-member health / error-rate / latency / quality summary); `suggestTuning(telemetry)` (deterministic heuristics — disable denied, deprioritize flaky/low-quality); `agenticTune(telemetry, tuner)` (opt-in LLM manager via structured output — run on a paid model, never the free pool it tunes); `applyTuning(members, actions)` (pure `PoolMemberSpec[]` transform → feed back to `definePool()`).
- `docs/AGENT-POOL.md` status → **IMPLEMENTED** (Phase 1–3).

## [0.0.5] - 2026-05-29
Agent×model pool — the v0.0.4 design is now **implemented** as an additive composition layer over the verified engine (engine core `runner`/`journal`/`concurrency`/`parseMeta`/`author` unchanged; **34/34** fidelity + crosscheck stay green; **228 tests**, was 146), plus accumulated hardening fixes.

### Added
- **Agent×model pool — Phase 1 (deterministic data plane):** `src/pool-state.ts` (persistable per-member status via `StateStore` memory/file/http; `PoolState` with rpm-60s + rpd-daily windows, circuit breaker, latency EWMA, same-day-rpd-preserving `loadSnapshot`); `src/pool-backend.ts` (`classifyError` + `PoolScheduler` + `PoolBackend` — label routing `req.model ∪ req.agentType`, priority→inFlight→latency tiebreak, fallback chains, per-member cooldown + blind backoff, single-probe half-open, never-silent-drop, awaitable `ready`); `src/pool-config.ts` (`definePool()` agent×model registry + `envKeys` key-rotation).
- **Quality escalation — Phase 2 (opt-in):** `src/pool-quality.ts` `withQualityEscalation()` — grade a cheap worker's output with a stronger grader; escalate below threshold (writer ≠ grader); token-accounted.
- **Gap-fixes (additive; no behavior change when unset):** `RunConfig.defaultModel` wired into `RunContext`; `AnthropicBackend` gains `baseURL?` + `apiKeyEnv?`.
- **`docs/BENCHMARKS.md`** — live-measured latency/throughput/parallel-ceiling/rate-caps across NVIDIA NIM (4-key pool, 118 models), Xiaomi MiMo V2.5 Pro, and the OpenRouter free pool, plus an agent×model harness matrix; `docs/AGENT-POOL.md` updated with measured capacity + cc-family integration.

### Fixed
- **`chainKey` separator collision** (`src/journal.ts`): changed separator from space `" "` to NUL `"\0"` so tuples like `("ab","c d")` and `("ab c","d")` no longer produce identical keys.
- **`_runStructured` retry token accounting** (`src/backend.ts`): accumulate `inputTokens`/`outputTokens` across all schema-retry attempts (was taking only the last attempt's tokens, losing earlier attempts).
- **`HttpAgentBackend` error body** (`src/http-agent-backend.ts`): on non-OK responses, read and include up to 300 chars of the response body in the thrown error message (was discarded); also noted that `estTokens` is a chars/4 ESTIMATE, not billed tokens.
- **CLI empty-key guard** (`src/cli.ts`): `ANTHROPIC_API_KEY` is now trimmed before truthy check — a whitespace-only value no longer silently selects `AnthropicBackend`.
- **`worker()` permission opt-out** (`src/cli-agent-backend.ts`): added `dangerouslySkipPermissions?: boolean` option (default `true`) so callers can disable `--dangerously-skip-permissions`; all existing `worker('ccz')` call sites unchanged.

### Tests
- **`test/journal.test.ts`**: regression test asserting no `chainKey` separator collision between `("ab","c d")` and `("ab c","d")`.
- **`test/concurrency.test.ts`**: test that a synchronously-throwing `fn` in `Limiter.run` rejects, releases the slot (`active` returns to 0), and subsequent runs still succeed.
- **`test/http-agent-backend.test.ts`**: test that a stalled (never-resolving) fetch is aborted when `timeoutMs` elapses and `run()` rejects with an abort/timeout error.

### Docs
- **`SECURITY.md`**: added two caveats — SSRF risk from caller-controlled `HttpAgentBackend` URLs; resume restores TEXT output only (not filesystem side-effects).

## [0.0.4] - 2026-05-29
Author-layer + maintenance release. Adds the author layer (any agent — not just Claude — writes the workflow script), a stricter lint gate, an `estTokens` dedupe, the design spec for a heterogeneous agent×model pool, and restores the nested-`workflow()` determinism sandbox (a 100-agent review fleet's #1 finding). **143 tests**; `compare` stays **34/34**; build + typecheck clean.

### Added
- **Author layer** (`src/author.ts`): `authorWorkflow()` lets any backend *write* the workflow script, with a separate `authorBackend` vs `runBackend` (+ `authorModel`, `dryRun`) — the script's author need not be its executor.
- **`docs/AGENT-POOL.md`** — locked design for a status-aware, heterogeneous **agent×model pool** (premium orchestrator + free/cheap workers; deterministic scheduler with rpm/rpd budget + circuit-breaker + `Retry-After`; persistable load/upload state; opt-in manager role). Design only — not yet implemented.
- **`docs/claude-dynamic-workflow-explained.html`** — single-file visual explainer.
- Demos: `ccz-author-demo.mjs` (author layer on free GLM), `fleet-review.mjs` (per-`req.model` fleet routing, `ccz` vs `ccxm`).

### Changed
- **Stricter TS lint**: `noUnusedLocals` + `noUnusedParameters` enabled (`tsconfig.json`).
- **`estTokens` deduped** into `src/utils.ts` (was copy-pasted in the CLI + HTTP backends).
- **SPEC.md** `agent()` semantics synced to code: the resume `journal.lookup` happens **before** `limiterRun`, so a fully-cached resume bypasses the concurrency slot.

### Fixed
- **Nested `workflow()` now runs in the same `node:vm` sandbox as the top level** (shared `runInSandbox`): child workflows have `Date.now()` / `Math.random()` blocked again, restoring resume determinism (the nested path had bypassed the sandbox via a host-realm `new Function`). The #1 consensus finding of a 100-agent `ccz`/`ccxm` review fleet, with a regression test.
- **`authorWorkflow` meters the author call's tokens** (`authorTokens` in the result, deducted from the run budget) instead of leaving them invisible to `budget`.

### Chore
- `.gitignore` hardened: `.env`, `*.tgz`, `.npm/`, `.claude/`.

## [0.0.3] - 2026-05-29
Quality-hardening release — two adversarial review rounds (a single-agent pass, then a 6-lens **free cross-model** sweep on `ccz`/`ccxm`), every confirmed finding fixed with a regression test. Coverage **77% → 91%**, **135 tests**; `compare` stays **34/34**.

### Fixed
- **Examples returned `undefined`** — `export const result = {...}` was stripped to a local; now `return {...}` (review-changes/research/loop-until-dry).
- **`parseMeta`** now blanks string/template literal *contents* (not just comments), so `export const meta =` inside a string/comment no longer mis-parses; escaped backticks in templates handled.
- **`CliAgentBackend`** — handle stdin EPIPE (no orchestrator crash); reject on ANY non-zero exit (no silent partial-stdout corruption); `codex()` preset uses locally-verified flags.
- **`AnthropicBackend`** — send a `tool_result` for *every* `tool_use` on schema retry (a bare text reply → API 400); a tool handler returning `undefined` no longer omits `content`; throws (not invalid output) on retry / maxToolTurns exhaustion.
- **`Limiter`** — reject non-positive/NaN `max` (was a silent deadlock); release the slot when `fn()` throws synchronously (was a leak).
- **`validate`** rejects `NaN`/`Infinity` as `number`. **`HttpAgentBackend`** wraps non-JSON responses with URL context.
- Resume lookup moved before the concurrency limiter (correct cached telemetry). **`node:vm` documented as NOT a security boundary** (`SECURITY.md`) — trusted input only.
- `crosscheck.mjs` resume assertion tightened to exactly 0 live calls; `compare.mjs` composition check compares the real trace; stale doc numbers/claims corrected across the docs.

### Tests
- New suites: `cli`, `progress`, `qa-hardening`, `review-fixes`. 135 tests; statement coverage ~91%.

### Pre-launch review (2026-05-29)
- Pre-launch review hardening: input validation for `runId`/`resumeFromRunId` (path-traversal guard, `^[A-Za-z0-9_-]{1,128}$`), `SECURITY.md` caveats expanded (child-workflow realm, env inheritance, stderr-in-errors, runId validation, parseMeta context).
- Privacy: stripped private skill-listing / internal tool-name attachments from committed `traces/`.
- Docs: corrected PARITY run-count (5→7+live e2e), blog version (v0.0.1→v0.0.3), RUNLOG exp-02 cache-key note, COMPARISON.md CliAgentBackend preset list; added Kimi K2.6 / Manus Wide Research comparison (§7).
- Packaging: `examples/` now included in npm tarball (`"files"` array in `package.json`).

## [0.0.2] - 2026-05-28
### Added
- **Launch blog / full teardown**: `docs/blog/2026-05-28-reverse-engineering-claude-dynamic-workflows.md` — method, 9 findings (each with its proving experiment), the reproduction, the live demo, positioning, honest boundaries.
- **Live end-to-end validation** (not just `MockBackend`): `tools/live-e2e.mjs` runs a 2-agent `parallel` through the engine with `CliAgentBackend.claude()` → spawns 2 real `claude -p` (haiku) processes → `["ALPHA","BETA"]`. Committed evidence in `traces/e2e-live/` (journal shows out-of-order completion with input order preserved — real parallel semantics).

### Fixed
- `CliAgentBackend.codex()` flags corrected to the **locally-verified** `codex exec` interface (this Codex has no `--ask-for-approval`; `--output-schema` takes a file, not inline JSON). The prior flags came from a different Codex version; surfaced by smoke-testing the CLI before trusting it. Added `bypass`/`extraArgs` options.

## [0.0.1] - 2026-05-28
First release — an evidence-grounded, behaviorally **1:1** reproduction of Claude Code dynamic workflows.

### Engine
- Primitives `agent` / `parallel` / `pipeline` / `phase` / `log` / `budget` / `workflow`, run as plain-JS scripts in a `node:vm` sandbox (blocks `Date.now`/argless `new Date`/`Math.random`; no `require`/`process`/`fetch`).
- `StructuredOutput` forced-tool schema path with validation + bounded retry.
- Append-only journal `{type,key,agentId,result}` with **prefix-chained `v2:` keys**; **content-addressed resume** (sequential→100% hit, edit→cascade, concurrent→partial).
- Concurrency cap `min(16, cores-2)`, lifetime cap 1000, turn/run-scoped output-token `budget` with hard ceiling.
- `opts.isolation:'worktree'` (git worktree per agent, graceful no-op off-git) and a named-workflow registry for `workflow('name')`.

### Backends (the basic unit is a pluggable agent — local → cloud)
- `MockBackend` (deterministic, schema-faking — offline tests + the fidelity gate).
- `AnthropicBackend` (Claude API + a tool-use loop).
- `CliAgentBackend` — real **local** agents: presets `.claude()`, `.codex()`, `.opencode()`, `.worker('ccz')`, `.custom()`.
- `HttpAgentBackend` — **cloud** remote runners (OpenAI Responses / Vertex Agent Engine / Bedrock / Claude Managed Agents via adapter).

### Evidence, fidelity & docs
- 7 real captured runs under `traces/` (`tools/harvest_trace.py`), `ANALYSIS.md` (every claim cited), `PROVENANCE.md`, `RUNLOG.md`.
- `tools/compare.mjs` differential **OURS vs CLAUDE = 34/34 = 100%** + `tools/crosscheck.mjs`; GitHub Actions CI runs both. 135 unit tests; `tsc` strict-clean.
- `SPEC.md`, `docs/PARITY.md` (honest raw-coverage matrix), `docs/COMPARISON.md` (vs raw + frameworks + managed platforms), examples (review pipeline, research fan-out, loop-until-dry), CLI (`run-workflow`).

### Findings (corrections to the public description, proven by experiments)
- Resume is 100% cache-hit only for **sequential** scripts; the cache key is **prefix-chained**, so an edit or a `parallel`/`pipeline` reorder cascades to every later call (experiment-06).
- `parallel` propagates a **synchronous** thunk throw (only async rejections become `null`) (experiment-05).
- Official resume is **same-session-only**; our journal-based cross-session replay is a superset.

[0.0.7]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.7
[0.0.6]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.6
[0.0.5]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.5
[0.0.4]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.4
[0.0.3]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.3
[0.0.2]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.2
[0.0.1]: https://github.com/robotlearning123/open-dynamic-workflow/releases/tag/v0.0.1
