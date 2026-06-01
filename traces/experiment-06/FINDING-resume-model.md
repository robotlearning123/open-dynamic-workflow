# FINDING — resume is PREFIX, via CHAINED keys (empirical)

**Experiment:** 4 sequential, **independent** agents (A,B,C,D — no agent's prompt embeds another's
output), run once (`run1-baseline/`), then **only B's prompt edited** (B1→B2) and resumed (`run2-resume-editB/`).

## Result
Resume re-ran **B, C, and D**; only **A** was served from cache. (run2 journal lines 9–14: three new
agentIds, results B2/C1/D1.)

| call | prompt edited? | run1 key | run2 key | outcome |
|---|---|---|---|---|
| A | no | `2a6d55…` | `2a6d55…` (same) | **cache HIT** |
| B | **yes** (B1→B2) | `518333…` | `11fa65…` (changed) | re-ran |
| C | no | `89c572…` | **`3d8450…` (CHANGED!)** | re-ran |
| D | no | `783b98…` | **`8a1d0e…` (CHANGED!)** | re-ran |

## Decisive observation
C and D had **identical prompts and identical invocation order**, yet their `v2:` keys **changed** after B
was edited. Therefore the cache key is **prefix-chained**: `key_n` depends on the whole prefix of calls
before it, not just `(prompt_n, opts_n, ordinal_n)`. Editing B perturbs the chain for every later call →
their keys change → they miss. A (before B) is unaffected → hits.

This **confirms the doc's** "longest unchanged prefix … the first edited/new call and everything after it
runs live" — and reveals the *mechanism*: a chained key. (It also re-explains exp-02: the concurrent
misses were a suffix because reordering perturbs the chain from that point on.)

## Correction to our implementation
Our v1 used `key = sha256(prompt + opts + ordinal)` (NOT chained) plus a `prefixIntact` flag. That
reproduced the *resume behavior* (A hit; B,C,D miss) but produced **wrong key values** (our C/D keys would
NOT change when B is edited). To be 1:1 we switch to:
- **chained key**: `key_n = "v2:" + sha256(chain_{n-1} ‖ prompt_n ‖ opts_n)`, advancing a running `chain`
  digest at each `agent()` invocation (in invocation order);
- **content-addressed resume**: build `Map<key,result>` from the prior journal's `result` events; a call
  hits iff its (chained) key is present. No separate prefix flag needed — the chain makes a single edit
  cascade to all later keys automatically, and a concurrent reorder perturbs the chain from that point.
- This also lets the journal event shape match the real one exactly: `{type,key,agentId,result}` (drop our
  extra `ordinal` field).
