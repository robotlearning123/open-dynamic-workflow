# Goal: Fully understand Claude Code "dynamic workflows" empirically (log/monitor/analyze, loop/test/verify) until we have enough verified detail to reproduce them 1:1 — then build that 1:1 reproduction.

> Historical planning artifact from the initial reverse-engineering sprint. It records the staging
> repo state at that time; current release/open-source status is tracked in `PROGRESS.md`.

Two halves: (A) **Understand** the real system from evidence (the official blog + real working logs we capture by running it), and (B) **Reproduce** it 1:1 as a TypeScript engine whose behavior matches the captured traces.

## Sources of truth (provenance)
- Official blog: https://claude.com/blog/introducing-dynamic-workflows-in-claude-code (fetched 2026-05-28; concepts only, no code).
- Real working logs: traces we harvest from running the *actual* Workflow tool in this session (the ground truth).
- Anthropic SDK shape: context7 `/anthropics/anthropic-sdk-typescript` (fetched 2026-05-28).

## Criteria (each must be VERIFIED, not assumed)

### A. Understanding (evidence-complete)
- [ ] C1 Every core primitive's semantics captured with a citing trace artifact — verify: `ANALYSIS.md` present; each claim cites `traces/...`; primitive checklist all ticked.
- [ ] C2 Journal format reproduced by a parser — verify: `python3 tools/harvest_trace.py` parses ALL transcripts with 0 errors and emits digests.
- [ ] C3 Resume/cache-hit behavior captured empirically — verify: a resume run's trace shows cached results and **no new** agent transcripts for unchanged calls.
- [ ] C4 Concurrency cap, budget (=output tokens), parallel order, pipeline no-barrier all evidenced — verify: specific cited trace lines in ANALYSIS.md.

### B. Reproduction (1:1, command-verifiable)
- [ ] C5 Engine type-checks — verify: `npm run typecheck` (`tsc --noEmit`) exit 0.
- [ ] C6 Unit tests pass — verify: `npm test` (`vitest run`) exit 0.
- [ ] C7 Each observed semantic has a passing test — verify: tests named for parallel-order, pipeline-no-barrier, schema=StructuredOutput, journal-2-event, v2-key, budget-output-tokens, concurrency-cap, resume-prefix-cache, date/random-block.
- [ ] C8 Fidelity cross-check — verify: `node tools/crosscheck.mjs` runs the SAME probe script through the repro (mock backend) and asserts its `journal.jsonl` matches the real one's shape/semantics; exit 0.
- [ ] C9 Resume works in repro — verify: a test asserts 2nd run of same script+args makes **0** backend calls (100% cache hit).

### C. Delivery
- [ ] C10 Everything logged + pushed to the initial staging GitHub repo — verify: `gh repo view --json visibility` succeeds for the owner and `git log` shows traces/ + analysis + engine committed & pushed.

## Verification command table
| Criterion | Command | Pass condition |
|-----------|---------|----------------|
| C2 | `python3 tools/harvest_trace.py <run>` | exit 0, digests written |
| C5 | `npm run typecheck` | exit 0 |
| C6 | `npm test` | exit 0 |
| C8 | `node tools/crosscheck.mjs` | exit 0 (assertions pass) |
| C9 | `npm test -- resume` | exit 0 |
| C10 | `gh repo view --json visibility` | repo visible to owner |

## Baseline (2026-05-28, before reproduction code)
- C1: PARTIAL — experiment-01 captured (parallel order, pipeline no-barrier, schema tool, journal 2-event, v2 key, budget=output tokens). Needs consolidation + resume/budget/loop experiments.
- C2: PARTIAL — manual parsing done; reusable harvester not yet written.
- C3: FAIL — no resume experiment yet.
- C4: PARTIAL — most evidenced; concurrency-cap not yet stress-probed.
- C5–C9: FAIL — no engine code yet.
- C10: FAIL — no git repo / GitHub remote yet.

## Sub-tasks → see TaskList (#1–#8).

## FINAL STATUS (2026-05-28) — ALL CRITERIA MET
- C1 understanding: **PASS** — ANALYSIS.md, every claim cites traces/.
- C2 journal parser: **PASS** — tools/harvest_trace.py parses all runs, 0 errors.
- C3 resume captured: **PASS** — exp-02 + FINDING-resume-semantics.md (partial-cache mechanism).
- C4 cap/budget/order/no-barrier: **PASS** — exp-01/03 (cap=16, parallel order, pipeline no-barrier, budget=output tokens).
- C5 typecheck: **PASS** — `tsc --noEmit` exit 0.
- C6 tests: **PASS** — vitest passed at this sprint snapshot.
- C7 per-semantic tests: **PASS** — named tests for each behavior incl. 1000-cap.
- C8 fidelity cross-check: **PASS** — `node tools/compare.mjs` = 34/34 = 100% (stable across runs).
- C9 resume in repro: **PASS** — resume test = 0 backend calls.
- C10 staging repo + push: **PASS** — https://github.com/robotlearning123/open-dynamic-workflow (default branch main, 253 files at this sprint snapshot).
- Boundaries (Wave C/D): nesting=1 level (exact msg), parallel sync-throw crashes / async-reject→null, pipeline stage-throw→null, empty→[], cap=16, lifetime cap 1000 (engine-tested). See ANALYSIS §12.

## Risk areas
- Parallel codegen drift across fan-out agents → mitigate with Opus-authored `src/types.ts` + `SPEC.md` contract before fan-out.
- Journal cache-key (`v2:<sha256>`) exact preimage unknown → reproduce *observable* semantics (stable hash of prompt+opts; prefix replay) and cross-check shape, not byte-identical hashes.
- vm sandbox correctness (Date/random block, top-level `return`, injected globals) → dedicated tests.
- Token cost of trace experiments → keep probes small, prefer haiku for data-gathering agents.
