# Agent Pool — heterogeneous, status-aware model routing

> Status: **IMPLEMENTED** — Phase 1 (scheduler/state/`definePool`) + Phase 2
> (`withQualityEscalation`) shipped in **v0.0.5**; Phase 3 (`pool-manager`:
> telemetry → tuning → re-author config) in **v0.0.6**. Additive layer over the
> verified core — the engine (`primitives.ts` / `runner.ts` / journal / sandbox /
> budget) is **not changed**; the pool is just another `AgentBackend` (`types.ts:87`),
> so the 1:1-reproduction claim + 34/34 fidelity gate stay intact.
> See `src/pool-state.ts` / `pool-backend.ts` / `pool-config.ts` / `pool-quality.ts` /
> `pool-manager.ts` and `docs/BENCHMARKS.md`.

## Goal

Run one workflow script across a **heterogeneous model pool** — a premium orchestrator
(Opus 4.8 / GPT-5.5) plus free/cheap workers (GLM, Xiaomi, OpenRouter-free, local Ollama) —
and make it **easy to configure for any agent team / custom model**, with **dynamic,
status-aware routing** (rate limit, access, quality, latency) whose **real status is easy to
load and upload**.

## Two axes: agent × model

The pool routes to a **(agent, model)** cell, not just a model — two orthogonal axes:

- **agent (harness)** — *who executes the task*, bringing its own tools (Bash/files/MCP):
  `cc` (Claude Code), `cx`/`codex`, `opencode`, `cursor`, the cc-family wrappers
  (`ccz`/`ccd`/`ccq`/`ccxm`/`ccor`), plus the bare-LLM-call "agents" `anthropic` and `http`.
- **model (LLM)** — *which brain powers that agent* — any LLM the agent accepts. `cc` can run
  Opus/Sonnet/Haiku or, via `ANTHROPIC_BASE_URL`, any anthropic-protocol model (verified:
  cc + free GLM through OpenRouter). `codex` takes `gpt-5.x`; `opencode` takes `provider/model`.

A member is a **(agent, model) cell** + a routing label + budget/health policy. The same model
can appear under different agents and vice-versa; you declare only the cells you use (sparse,
not a dense matrix). A model that the agent can't run surfaces as a 4xx → the scheduler marks
the member `access=denied` and routes to the next cell.

## Why this shape (the two hard-won decisions)

1. **No LLM in the routing hot path.** Rate-limit / access / latency are deterministic
   facts (a 429 with `Retry-After`, a 401/404). Routing on them is a state machine, not an
   LLM call — putting an LLM on every `agent()` dispatch adds seconds + cost, and the manager
   would itself burn rate limit (if it ran on the free pool it would 429 — *who manages the
   manager?*). So: **deterministic data plane** for routing, **agentic control plane** for
   judgment (quality) and tuning (composition), out of band and low-frequency.

2. **State must persist (load/upload), or the daily cap is fiction.** `:free` models share
   **20 req/min + 1000 req/day** (verified 2026-05-29). `rpd` is a *daily* counter; if it
   isn't loaded at startup, every restart thinks it has a full budget and blows the cap.
   Cooldowns, circuit state, and quality scores have the same need. Persisting also lets a
   whole team **upload/share one real view** of the pool.

## Three artifacts

| Artifact | What | Who writes it | Persistence |
|---|---|---|---|
| **Pool config** | who is in the pool + how to reach them (`envKey` refs, **no secrets**) | human, or manager agent via the author layer | source file (`pool.config.ts` / JSON) |
| **Pool state** | live per-member status: health, circuit, cooldown-until, rpm/rpd used, latency EWMA, quality score | scheduler (automatic) | **`StateStore` (load/upload)** |
| **Scheduler** | reads config + state, routes each request, no LLM | — | in-memory + flushes state |

### Pool config (declarative, portable, secret-free)

```ts
export default definePool({
  default: "worker",
  state: fileStore(".runs/pool-state.json"),
  members: [
    // role              agent (harness)    model (any LLM the agent accepts)
    { name: "orchestrator", match: ["orchestrator", "author"], agent: "cc",
      model: "claude-opus-4-8", apiKeyEnv: "ANTHROPIC_API_KEY", priority: 100 },
    { name: "gpt5.5", match: "gpt5.5", agent: "codex", model: "gpt-5.5", priority: 90 },
    { name: "worker", match: ["worker", "glm"], agent: "http",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "z-ai/glm-4.5-air:free", envKey: "OPENROUTER_API_KEY",
      rpm: 20, rpd: 1000, concurrency: 4, priority: 50, fallback: ["nvidia", "xiaomi", "local"] },
    { name: "xiaomi", match: "xiaomi", agent: "anthropic",
      baseURL: "https://token-plan-sgp.xiaomimimo.com/anthropic",
      model: "mimo-v2.5-pro", apiKeyEnv: "MIMO_API_KEY",
      concurrency: 8, priority: 55 },   // MiMo V2.5 Pro — measured 10 concurrent clean, ~31 tok/s
    { name: "nvidia", match: ["nvidia", "fast", "reason"], agent: "http",
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "deepseek-ai/deepseek-v4-flash",   // chat; or step-3.7-flash (207 tok/s reasoning), kimi-k2.6, glm-5.1
      envKeys: ["NVIDIA_NIM_1", "NVIDIA_NIM_2", "NVIDIA_NIM_3", "NVIDIA_NIM_4"],  // round-robin → ~4x rpm
      concurrency: 24, priority: 70 },   // 4-key NIM pool — measured 24/24 concurrent
    { name: "local",  match: "local",  agent: "ccq" },            // local Qwen / Ollama wrapper
    { name: "review", match: "review", agent: "cursor", model: "<cursor-model>" },
    { name: "mock",   match: "mock",   agent: "mock" },           // CI / no keys
  ],
})
```

A member's `agent` is the harness, `model` is the LLM — the registry maps `agent` → backend:

| `agent` | harness | backend | model format |
|---|---|---|---|
| `anthropic` | bare Anthropic Messages call (no tools) | `AnthropicBackend` | claude id; any via `baseURL` |
| `http` | bare OpenAI-compatible call (no tools) | `HttpAgentBackend` | `provider/model` (OpenRouter, Ollama) |
| `cc` / `claude` | Claude Code (full tools) | `CliAgentBackend.claude` | claude id; or any LLM via `ANTHROPIC_BASE_URL` |
| `codex` / `cx` | OpenAI Codex | `CliAgentBackend.codex` | `gpt-5.x` |
| `opencode` | OpenCode | `CliAgentBackend.opencode` | `provider/model` |
| `cursor` | cursor-agent | `CliAgentBackend.cursor` (new preset) | cursor model id |
| `ccz`/`ccd`/`ccq`/`ccxm`/`ccor` | cc-family wrappers | `CliAgentBackend.worker(bin)` | wrapper-fixed or `--model` |
| `mock` | none (test / CI) | `MockBackend` | — |
| `(fn)` | custom | `CliAgentBackend.custom` | — |

So "HTTP vs CLI" is **not a global mode**; each member picks its own `(agent, model)`. Adding a
custom agent or a custom model = add a row.

An `http`/`anthropic` member may take **`envKeys: string[]`** to round-robin several keys — the
scheduler treats the set as one member with **N× the rpm** (the 4-key NVIDIA NIM pool → measured
**24/24 concurrent**, vs ~13 per single key). **Measured capacity, throughput, and rate caps for
every member are in [`BENCHMARKS.md`](./BENCHMARKS.md).**

### Workflow scripts use logical labels (portable across teams)

```ts
const plan    = await agent(designPrompt, { model: "orchestrator" });   // -> Opus
const reviews = await parallel(files.map(f => () =>
                  agent(review(f), { model: "worker" })));               // -> free GLM →(429)→ ccxm → ccq
```

`match` matches `req.model` **or** `req.agentType`, with `default` as the catch-all. The same
script runs on any team by swapping the config — a team with no OpenRouter key maps `worker`
to local Ollama instead.

### Pool state + StateStore (load / upload)

```ts
interface StateStore {
  load(): Promise<PoolStateSnapshot | null>;   // startup: warm-start from REAL status
  save(s: PoolStateSnapshot): Promise<void>;   // on change: persist / upload
}
// defaults: memoryStore() | fileStore(path) | httpStore({ getUrl, putUrl, headers })
```

`PoolStateSnapshot` per member: `{ rpmCount/rpmWindowStart, rpdCount/rpdDay,
consecutiveFailures, circuit, cooldownUntil, access, latencyEwmaMs, qualityScore,
totals..., lastError }`. `rpd` resets on date change; `rpm` on a 60s window.

## Data plane: `PoolScheduler` (deterministic, contributes ~90%)

On `run(req)`:
1. **candidates** = members whose `match` includes `req.model` ∪ `req.agentType` (else `default`).
2. **eligible** = candidates that are `circuit=closed/half-open` ∧ `now ≥ cooldownUntil` ∧
   `access=ok` ∧ `rpm/rpd budget remaining` ∧ `in-flight < concurrency`.
3. **pick** highest `priority`; ties → lowest in-flight load → lowest `latencyEwmaMs`.
4. run it; **on success** update latency EWMA + counters; **on failure** classify the error
   (`classifyError(err) → { retryable, retryAfterMs, fatal }`): 429 → set `cooldownUntil =
   now + retryAfterMs`, or **blind exponential backoff** when the provider sends no `Retry-After`
   (NIM + MiMo send none; only OpenRouter does); 401/403/404 → `access=denied` (long cooldown + event); trip the
   circuit breaker after N consecutive failures; then **advance to the next eligible
   candidate** (fallback emerges from health, not a hardcoded chain).
5. **never silent**: `log()` every shed ("free GLM cooling 21s → worker → ccxm").
6. flush state via the `StateStore`.

Circuit breaker per member: `closed → (N fails) → open → (cooldown) → half-open → (ok) → closed`.

## Control plane: the manager role (opt-in, the genuinely agentic part)

- **Quality escalation** — grade a cheap worker's output with a **stronger** model; if score <
  threshold, escalate/re-run on a higher tier. This is the runtime form of the project's
  *writer ≠ reviewer* cross-model-review rule (free GLM writes, Opus grades — never self-grades).
- **Adaptive tuning** — an agent periodically (or on a `member-disabled` event) reads the
  persisted state + telemetry and **rewrites `pool.config` via the existing author layer**
  (`author.ts`) — dynamic composition with no new machinery.
- **Who manages the manager** — the manager always runs on Opus/paid, never on the free pool.

## Running it on Claude Code today (cc-family) — verified

The `agent:"cc"` cell (Claude Code driven by a pool model) works **now**, proven with real tool
calls (`BENCHMARKS.md §4`). Claude Code speaks only the Anthropic protocol, so:

- **Anthropic-native models → direct wrapper** (the `ccz` pattern): `ccxm` → Xiaomi MiMo,
  `ccor` → OpenRouter (any model it hosts). Export `ANTHROPIC_BASE_URL` + auth + `exec claude`.
- **OpenAI-only models → `claude-code-router` proxy**: NVIDIA NIM has no Anthropic endpoint, so
  `ccnv` points `ANTHROPIC_BASE_URL` at a local `ccr` (`:3456`) that bridges NIM chat/completions
  ↔ Anthropic and **round-robins the 4 NIM keys** via a `CUSTOM_ROUTER_PATH` script (top models:
  `step-3.7-flash` default, `deepseek-v4-pro/flash`, `kimi-k2.6`, `glm-5.1`).
- **`codex` (`cx`) ✗ NIM**: codex 0.135 requires the OpenAI Responses API; NIM's partial impl
  rejects codex's multi-agent tool schema → use cc-via-router for NIM.

Verified end-to-end (each created a file via a tool): `ccnv`+`step-3.7-flash` 12s, `ccor`+free GLM
26s, `ccxm`+MiMo ~27s. Free models are worker-tier (slow ~12–40s, flaky) — keep the orchestrator on
Opus/paid. This is the pool's `cc × <model>` cell with key-rotation + health layered on.

## Minimal change set (all additive; core untouched)

| Change | File | Nature |
|---|---|---|
| `PoolScheduler` + `PoolBackend` (routing, breaker, budget, Retry-After) | `src/pool-backend.ts` (new) | composition |
| `PoolState` + `StateStore` + `memoryStore`/`fileStore`/`httpStore` | `src/pool-state.ts` (new) | new |
| `definePool(spec)` builder (data → backends → PoolBackend) | `src/pool-config.ts` (new) | new |
| wire `RunConfig.defaultModel` (`ctx.defaultModel` is declared `types.ts:191` but never set) | `primitives.ts`, `types.ts` | 1-line additive |
| `AnthropicBackend` gains `baseURL?` + `apiKeyEnv?` | `backend.ts` | additive ctor arg |
| tests + a demo workflow | `test/pool-backend.test.ts`, example | new |

## Build phases

- **Phase 1 — deterministic core (must-have):** `PoolState`/`StateStore`, `PoolScheduler`,
  `PoolBackend`, `definePool`, the two gap-fixes, tests. Usable on its own.
- **Phase 2 — quality escalation hook** (writer ≠ grader), opt-in.
- **Phase 3 — manager agent loop**: read state/telemetry → rewrite config via author layer.

## Non-goals / guardrails

- No change to engine semantics (concurrency cap, journal/resume, budget gate, sandbox).
- No secrets or `op://` paths in the repo — config references `envKey` only.
- No LLM in the per-request routing path.
