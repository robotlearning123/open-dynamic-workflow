# FINDING — Resume / cache-key semantics (empirical)

**Experiment:** re-ran `experiment-01-probe.workflow.js` via `Workflow({scriptPath, resumeFromRunId:"wf_69d4a9ee-399"})` — identical script, identical args.

**Raw evidence:** `traces/experiment-02-resume/run/journal.jsonl` (lines 17–22 are the resume delta), `task-output.json`, and the prompt diff below.

## What happened
- Resume duration 8.7s (first run 34.3s); `tool_uses=0`; `agent_count=8`.
- journal grew 16 → 22 lines (+3 agents × 2 events); agent transcripts 8 → 11 (+3).
- **Cache HIT (served silently, no new journal line): 5 agents** — 3 fanout (`parallel`) + 2 pipeline stage-1.
- **Cache MISS (re-ran live, new agentId + NEW v2 key): 3 agents** — 2 pipeline stage-2 + 1 synthesize.

| logical call | first-run key | resume key | result |
|---|---|---|---|
| fanout ×3 | b902…/15db…/b352… | (same) | HIT |
| pipe1 ×2 | a607…/0ec6… | (same) | HIT |
| pipe2-item0 | `v2:e901f44…` | `v2:73e6748…` | **MISS** |
| pipe2-item1 | `v2:8e674c5…` | `v2:120e52f…` | **MISS** |
| synth | `v2:f7ec08a…` | `v2:f0b78a5…` | **MISS** |

## The decisive measurement (prompt diff)
- `pipe2-item0`: resume prompt is **byte-identical** to the first run (len 260 == 260) **yet got a new key and re-ran**. → the cache key is **NOT** `hash(prompt+opts)` alone; it carries a **call-ordinal / positional component**.
- `synth`: resume prompt **differs** — it embeds the pipeline (stage-2) results, which changed because stage-2 re-ran with different LLM text. → a downstream **cascade**.

## Mechanism (inferred, consistent with all observations)
`key = v2 : hash( prompt + opts + invocation-ordinal )`, where the ordinal is a monotonic counter assigned in the order `agent()` is actually invoked.

- `parallel()` thunks and `pipeline()` **stage-1** are invoked in deterministic array order → stable ordinals across runs → **keys stable → HIT**.
- `pipeline()` **stage-2** is invoked only when its item's stage-1 *await* resolves. First run: item "no-barrier" finished stage-1 first → its stage-2 invoked first (ordinal 6). Resume: stage-1 served from cache ~instantly → items proceed in array order → item "stage-semantics" stage-2 invoked first (ordinal 6). The ordinals **swapped** vs the first run → keys change → **MISS**, and `synth` (which consumes stage-2 output) misses by cascade.

## Why it matters for 1:1 reproduction
- The doc claim *"Same script + same args → 100% cache hit"* holds **only for deterministic invocation order** (purely sequential scripts, or the deterministic prefix).
- **Concurrency (`parallel`/`pipeline`) introduces completion-order nondeterminism that shifts downstream ordinals → partial cache hit on resume**, not 100%.
- Reproduction must therefore: (1) put an invocation-ordinal in the key, (2) replay the longest prefix whose `(ordinal,key)` still matches, (3) go live at the first divergence and for everything after. This yields the observed sequential-100% / concurrent-partial behavior.

*(The exact internal preimage of the v2 hash is not observable; we reproduce the observable behavior, not the byte-identical hash. Ordinal is "invocation order"; with cap=16 and ≤3 concurrent here, invocation≈start order — the two cannot be disambiguated from this run.)*
