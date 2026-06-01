# Benchmarks — agent pool members (live-measured)

> Every number is a **live measurement on 2026-05-29**, single client, single run (not averaged).
> Free pools fluctuate minute-to-minute — treat as order-of-magnitude, not SLA. Feeds the default
> budgets/concurrency in [`AGENT-POOL.md`](./AGENT-POOL.md). **No raw secrets recorded** —
> provider account labels and key prefixes are intentionally omitted.

Two test axes (per the agent×model pool model):

1. **Model test** — the raw LLM over its API (latency, throughput, parallel ceiling, rate caps).
2. **Agent×model test** — a real coding-agent *harness* powered by that model (end-to-end wall).

---

## Method (reproducible)

| aspect | detail |
|---|---|
| client | Python `urllib` (no SDK), `concurrent.futures.ThreadPoolExecutor` for parallel |
| latency | wall-clock around the HTTP call (includes TTFT + network) |
| throughput | `completion_tokens / wall` — **wall-clock**, so it *understates* steady-state, esp. for reasoning models |
| single prompt | `"Write one concise paragraph (about 80 words) on what an API rate limit is…"` |
| parallel prompt | `"Reply with exactly: ok"`, `max_tokens=16` |
| throughput prompt | `max_tokens` 300–1200 to observe `finish_reason` |
| parallel method | fire N identical requests via a thread pool; count `200`/`429`; record per-request latency |
| rate caps | read response headers + the `429` body |

**Endpoints / protocols**

| provider | endpoint | protocol | auth |
|---|---|---|---|
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1/chat/completions` | OpenAI | `Authorization: Bearer <NVIDIA_NIM_API_KEY>` (4 pooled keys) |
| Xiaomi MiMo | `https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages` | Anthropic | `x-api-key: <MIMO_API_KEY>`, `anthropic-version: 2023-06-01` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | OpenAI | `Authorization: Bearer <OPENROUTER_API_KEY>` |

**Reasoning-model caveat:** reasoning models return `reasoning_content` separately; a small
`max_tokens` is consumed entirely by reasoning → `content` empty, `finish_reason=length`.

---

## 1. NVIDIA NIM — `integrate.api.nvidia.com` (OpenAI-compatible)

**4 pooled free keys**, all valid during the measurement, each exposing **118 models across 29 vendors**.
Account labels and key prefixes are intentionally omitted from this public artifact.

**Inventory (118 models):** nvidia 43 · google 11 · meta 11 · mistralai 11 · microsoft 5 · ibm 4 ·
qwen 4 · writer 4 · deepseek-ai 3 · openai 2 · stepfun-ai 2 · (+18 vendors ×1). Notable:
`qwen/qwen3.5-397b-a17b`, `qwen/qwen3-coder-480b-a35b-instruct`, `meta/llama-4-maverick-17b-128e`,
`openai/gpt-oss-120b`/`-20b`, `nvidia/nemotron-3-super-120b-a12b`, `deepseek-ai/deepseek-v4-pro`/`-flash`,
`moonshotai/kimi-k2.6`, `z-ai/glm-5.1`, `stepfun-ai/step-3.7-flash`/`-3.5-flash`, `minimaxai/minimax-m2.7`.

### Single-call latency + steady throughput (key #1)

`wall tok/s` = short ~80-word prompt (TTFT-dragged); `steady tok/s` = longer `max_tokens=400` gen.

| model | wall | out | wall tok/s | steady tok/s | finish | kind | notes |
|---|---|---|---|---|---|---|---|
| `stepfun-ai/step-3.7-flash` | 5.8s | 1200 | **207** | — | length | **reasoning** | fastest anywhere; only `reasoning_content` (4535 ch), no final answer until reasoning ends; needs large `max_tokens` |
| `moonshotai/kimi-k2.6` | 23.5s | 97 | 4.1 | **21.1** | stop | chat | direct answer ✓ |
| `deepseek-ai/deepseek-v4-pro` | 17.1s | 100 | 5.8 | **16.5** | stop | chat | direct answer ✓ |
| `deepseek-ai/deepseek-v4-flash` | 12.7s | 78 | 6.1 | 7.7 | stop | chat | direct answer ✓ |
| `z-ai/glm-5.1` | 36.6s | 96 | 2.6 | — | stop | chat | slow |
| `minimaxai/minimax-m2.7` | 74s+ | 64 | ~0.9 | — | length | **reasoning** | **too slow interactive**; 120s timeout @ `mt=300` |

### Per-key latency varies wildly — and a hammered key degrades

`deepseek-v4-flash`, `mt=32`, one call per key:

| key | latency |
|---|---|
| key A | **9.8s** |
| key B | 18.0s |
| key C | 89.6s |
| key D (heavily used this session) | **timeout (>90s)** |

→ free NIM latency is **spiky (10s–90s+)** and a worked key **degrades** — concrete reason to rotate keys and apply a per-key cooldown / circuit-breaker.

### Parallel ceiling

Single key (`step-3.7-flash`, `mt=16`):

| N | 200 / 429 | note |
|---|---|---|
| 4 | 4 / 0 | |
| 8 | 8 / 0 | |
| 13 | 13 / 0 | fresh key |
| 16 | 13 / 3 | worked key #1 |
| 20 | **19 / 1** | fresh key |

→ **per-key ceiling ≈ 13–20** (depends on key health). `429` body `{"status":429,"title":"Too Many Requests"}` — **no `Retry-After`**, no rate-limit headers.

4-key rotation (round-robin):

| N concurrent | 200 / 429 |
|---|---|
| 24 | **24 / 0** |
| 32 | **32 / 0** |
| 48 | 30 / 18 |

→ **aggregate ceiling ≈ 32 concurrent clean**, saturates by 48 — *not* a clean 4× (a shared account/IP cap appears above ~32).

---

## 2. Xiaomi MiMo V2.5 Pro — `token-plan-sgp.xiaomimimo.com/anthropic` (`ccxm`)

Anthropic-compatible; model `mimo-v2.5-pro`; non-reasoning (returns direct `content`).

| test | result |
|---|---|
| single (short) | 7.05s, in=82 out=121, ~17 tok/s |
| steady throughput | `mt=800` ran to completion → **~31.5 tok/s**, `finish=stop` |

### Parallel (`mt=16`)

| N | 200 / 429 | wall | ok-latencies (s) |
|---|---|---|---|
| 4 | 4 / 0 | 4.14 | 3.08, 3.24, 3.42, 4.14 |
| 8 | 8 / 0 | 5.26 | 4.97×5, 5.22, 5.24, 5.26 |
| 10 | **10 / 0** | 3.13 | — |
| 12 | 7 / 5 | — | — |
| 16 | 9 / 7 | — | — |

→ **ceiling ≈ 8–10 concurrent.** `429` body `{"error":{"code":"429","message":"Too many requests","type":"limitation"}}` — **no `Retry-After`**.

---

## 3. OpenRouter free pool — `openrouter.ai`

Shared **20 req/min + 1000 req/day** across all `:free` models (account is paid → 1000/day tier).
`429` is the only provider here that returns **`Retry-After`** (~21s). **27 free models** of 357 total.

### Tested

| model | provider | status | latency | tok/s | parallel (6) | note |
|---|---|---|---|---|---|---|
| `openrouter/owl-alpha` | Stealth | ✅ 200 | 5.72s | ~16 | **6/6** (2.5–3.0s) | cloaked model, 1.05M ctx; parallel-clean |
| `z-ai/glm-4.5-air:free` | Z.AI | ✅ 200 | 5.59s | ~29 | **6/6** (1.2–1.8s, 2 tail to 14/38s) | the reliable free workhorse |
| `moonshotai/kimi-k2.6:free` | (varies) | ✅ 200 | 34.7s | **80** | **0/6** all 429 | reasoning-heavy (2704 out tok); single-shot only |
| `meta-llama/llama-3.3-70b-instruct:free` | Venice | ❌ 429 | — | — | — | upstream saturated, `Retry-After:21` |
| `qwen/qwen3-coder:free` | Venice | ❌ 429 | — | — | — | |
| `qwen/qwen3-next-80b-a3b-instruct:free` | Venice | ❌ 429 | — | — | — | |
| `deepseek/deepseek-v4-flash:free` | Crucible | ❌ 429 | — | — | — | |
| `google/gemma-4-31b-it:free` | Google AI Studio | ❌ 429 | — | — | — | |
| `openai/gpt-oss-20b:free` | — | ❌ 404 | — | — | — | blocked by account privacy/data-policy |
| `nvidia/nemotron-nano-9b-v2:free` | — | ❌ 404 | — | — | — | blocked by privacy/data-policy |

> `owl-alpha` initially 404'd (privacy/data-policy) earlier in the session, then succeeded —
> stealth-model availability / policy routing changes over time.

### Free-model inventory (27, with context length)

`openrouter/owl-alpha` 1.05M · `deepseek-v4-flash:free` 1.05M · `qwen3-coder:free` 1.05M ·
`nvidia/nemotron-3-super-120b-a12b:free` 1.0M · `kimi-k2.6:free` 262k · `gemma-4-26b/31b-it:free` 262k ·
`qwen3-next-80b:free` 262k · `poolside/laguna-m.1/xs.2:free` 262k · `minimax-m2.5:free` 205k ·
`openrouter/free` 200k · `nemotron-3-nano-30b/omni:free` 256k · `llama-3.3-70b:free` 131k ·
`hermes-3-llama-3.1-405b:free` 131k · `gpt-oss-20b/120b:free` 131k · `llama-3.2-3b:free` 131k ·
`nemotron-nano-9b/12b:free` 128k · `z-ai/glm-4.5-air:free` 131k · `liquid/lfm-2.5-1.2b:free` 32k ·
`dolphin-mistral-24b-venice:free` 32k.

---

## 4. Agent×model test (a harness powered by the model) — tool calls VERIFIED

Not just "connects" — each path was driven through a real harness and **made a real tool call that
created a file on disk**.

### Tool-calling capability — NVIDIA NIM (OpenAI `tools`)

| model | structured `tool_calls`? |
|---|---|
| `deepseek-v4-flash`, `deepseek-v4-pro`, `kimi-k2.6`, `glm-5.1`, `qwen3-coder-480b`, `gpt-oss-120b`, `step-3.7-flash` | ✅ correct name + args |
| `llama-4-maverick` | ❌ emits the call as **text**, not structured |
| full agent loop (deepseek-v4-pro: call → tool result → `"Done!"`) | ✅ |

7/8 emit correct structured calls; the multi-turn loop works.

### Real end-to-end harness runs (each created a file via a tool)

| harness × model | wall | result |
|---|---|---|
| **`ccnv`** = cc × **NVIDIA NIM** (via claude-code-router), `step-3.7-flash` | **12s** | ✅ file `STEP_OK` |
| `ccnv` = cc × NIM `deepseek-v4-pro` | 27–41s | ✅ file `NIM_4KEY_OK` (spread across the 4 rotating keys) |
| `ccor` = cc × OpenRouter `glm-4.5-air:free` | 26s | ✅ file `CCOR_TOOL_OK` |
| `ccxm` = cc × Xiaomi MiMo V2.5 Pro (`--bare`) | ~27s | ✅ "ccxm OK" |
| **`cx` (codex 0.135) × NIM** | — | ❌ **blocked**: codex needs the OpenAI *Responses* API; NIM's partial impl rejects codex's `namespace` multi-agent tool schema (400) + free keys 429 |

### Reaching each provider from `cc`

- **Anthropic-native (no proxy):** MiMo (`ccxm`), OpenRouter (`ccor`) — point `ANTHROPIC_BASE_URL`
  straight at them. OpenRouter tool calls verified on **both** its OpenAI endpoint (`tool_calls`)
  and its Anthropic endpoint (`tool_use`).
- **OpenAI-only (needs a proxy):** NVIDIA NIM has no Anthropic endpoint → **claude-code-router**
  (`ccr`, local `:3456`) bridges NIM chat/completions ↔ Anthropic, with a `CUSTOM_ROUTER_PATH`
  round-robining the **4 NIM keys**. Wrapper `~/.local/bin/ccnv`. See `AGENT-POOL.md`.

**Lesson:** the cc harness adds ~4× latency vs a raw call (≈27s vs ≈7s trivial); free models are
**worker-tier** (slow + flaky) — orchestrate with Opus/paid. Stateless fan-out → prefer the bare
`http`/`anthropic` member; use the CLI/cc harness when the worker must run tools.

---

### Fleet matrix — structured code review (real workload, 2026-05-29)

Beyond the trivial "create a file" tool calls above, the fleet was driven through a **real
structured-review workload**: 6 workers × 10 source modules (56–539 lines of USD/pxr sim code) =
**60 attempted cells**, each pinned to one worker via `PoolBackend` label routing, `--bare --max-turns 1`
(single-shot), per-worker concurrency 2, JSON-schema review output. Harness:
[`tools/fleet-matrix.mjs`](../tools/fleet-matrix.mjs). Wall **574s**.

Release audit note: the original `ccfree-flash` row is excluded from model-quality conclusions because
its worker command omitted the cc-family prompt/sandbox flags used by the other wrappers. The harness is
fixed in `v0.0.7`; rerun `WORKERS=ccfree-flash node tools/fleet-matrix.mjs` before drawing conclusions
about that worker.

| worker | ok/10 | valid JSON | findings | errorRate | avg ok latency | circuit | verdict |
|---|---|---|---|---|---|---|---|
| **ccxm** (Xiaomi MiMo) | 9 | 9 | 9 | 0.10 | 56s | closed | ⭐ best structured-review worker |
| **ccq** (local Qwen) | 7 | 7 | 21 | 0.30 | 54s | closed | most findings — but ≥1 was a verified hallucination |
| **ccz** (GLM-5.1) | 6 | 6 | 1 | 0.40 | 55s | closed | reliable but conservative |
| **ccor** (OpenRouter) | 7 | **0** | 0 | 0.30 | 33s | closed | HTTP 200 + prose, **never parseable JSON** |
| **ccd** (DeepSeek) | 2 | 2 | 0 | 0.80 | 96s | closed | times out on files >~300 lines |
| **ccfree-flash** (NIM via router) | — | — | — | — | — | — | excluded: original invocation bug; rerun required |

**Lessons (agent×model, real task):**

- **Latency scales with input size.** Trivial prompts are 8–12s (`--bare`), but reviewing a 539-line
  file blows past 120s → `ccd` timed out on 80% of cells. Budget timeout by file size, not a flat cap.
- **"ok" ≠ usable.** `ccor` returns 200 + prose every time but **never** valid JSON → unusable for
  schema/structured tasks despite a 0.30 errorRate. Measure *parseable* output, not just exit code.
- **Circuit breaker path exercised in production.** The malformed `ccfree-flash` invocation drove
  consecutive worker failures and opened that member's breaker; this validates failure accounting and
  breaker telemetry, but not `ccfree-flash` model quality.
- **Quantity ≠ quality.** `ccq` emitted the most findings (21) but one "critical" was a
  **hallucination** (claimed `UsdGeomXformOp.GetOpName()` returns only a suffix — empirically it
  returns the full `xformOp:rotateZ:_blade`). **Free-fleet findings are leads; verify each against
  source/API before acting.**
- **Pick:** `ccxm` for structured review (90% valid, real findings, non-reasoning); `ccz` as a
  conservative second opinion; avoid `ccor` for schema tasks. Re-test `ccfree-flash` with the fixed
  harness before using it for structured review.

> Single run, one workload (USD/pxr Python), `--max-turns 1` (single-shot; a multi-turn agent that
> reads files itself would score differently). Findings quality is workload-specific.

---

## 5. Consolidated ranking → pool roles

| role | best pick | why |
|---|---|---|
| **high-concurrency fan-out** | NVIDIA NIM (4-key rotation) | 24/24 concurrent measured; rotate keys for more |
| **reliable parallel, direct answers** | Xiaomi MiMo (`ccxm`) | 10 concurrent clean, ~31 tok/s, non-reasoning |
| **fastest raw throughput** | `step-3.7-flash` (NIM) | 207 tok/s — but reasoning-only, needs big `max_tokens` |
| **cheap single-shot ($0)** | `z-ai/glm-4.5-air:free` or `owl-alpha` (OpenRouter) | free; parallel-safe to ~6 |
| **deep reasoning** | `step-3.7-flash`, `minimax-m2.7`, `kimi-k2.6` | route long-thinking tasks here; avoid for short tasks |
| **orchestrator / quality grader** | Opus 4.8 / GPT-5.5 (paid) | judgment + cross-model grading (writer ≠ grader) |

**Backoff:** only OpenRouter sends `Retry-After`; NIM + MiMo do not → **blind exponential backoff**.
**Key rotation** is a member feature: `envKeys: string[]` → one member, N× rpm.

---

## 6. Gaps / honesty

- Single-run, wall-clock throughput; reasoning models understated; no percentiles/averaging.
- Agent×model **not tested for NIM** (codex/opencode path) — open gap.
- `minimaxai/minimax-m2.7` effectively **unusable** interactively (too slow).
- Free-pool 429 rates drift minute-to-minute; `owl-alpha`/`deepseek-v4-flash` access flipped during the session.
- NIM context-length per model not queried (118 models; only 6 latency-tested).
- Reproduction scripts were run from `/tmp` (ephemeral); method table above is the source of truth.

## 7. TODO

- [ ] **wafer pass** — add a benchmark pass for the Cerebras (wafer-scale) inference API (not yet covered).
