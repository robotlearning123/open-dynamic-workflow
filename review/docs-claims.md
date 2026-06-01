> Historical adversarial-review artifact. This is not the current vulnerability list; see `review/README.md` and `PROGRESS.md` for current status.

Now I have all the data I need. Let me compile the final findings list.

---

## Findings — docs-claims dimension

### 1. **Stale test count "107" in 4 docs (actual: 125)**
**Severity: MED**

README:51, README:72, CHANGELOG:31, and blog:70,123 all claim "107 tests." The actual count is **125 tests across 14 files** (`npx vitest run` → `Tests 125 passed (125)`). The number drifted after two post-release commits added tests (7d2a2c3 and b859f1e).

**Confirmed by:** `npx vitest run 2>&1 | grep Tests` → `125 passed (125)` vs `grep -rn "107 tests\|107 unit\|107 vitest" README.md CHANGELOG.md docs/blog/*.md`

**Fix:** Update all 5 occurrences of "107" → "125" (and consider using a script-generated count to prevent future drift).

---

### 2. **CONTRIBUTING.md cites stale fidelity gate score "27/27" (actual: 34/34)**
**Severity: HIGH**

CONTRIBUTING.md:7 says `node tools/compare.mjs # OURS vs CLAUDE must stay 27/27 = 100%`. The gate is actually **34/34**. A contributor following these instructions would not notice the mismatch, but the quoted expectation is wrong and would be confusing if the gate ever regressed below 34.

**Confirmed by:** `node tools/compare.mjs 2>&1 | tail -1` → `FIDELITY: 34/34 = 100.0%` vs `grep "27/27" CONTRIBUTING.md`

**Fix:** Change `27/27` → `34/34` in CONTRIBUTING.md:7.

---

### 3. **ANALYSIS.md intro says "ran the real Workflow tool four times" — actually 7 experiments**
**Severity: MED**

ANALYSIS.md:3 says *"we ran the **real** Workflow tool four times"* but the document's own experiment table (lines 13–21) lists experiments 01–07 (7 entries). Sources §1 (line 9) also says `traces/experiment-01..04/`, omitting 05–07. The opening was written for Phase 1 (4 runs) and never updated when experiments 05–07 were added.

**Confirmed by:** `grep "^|" ANALYSIS.md | grep "0[1-7]"` → 7 rows vs `sed -n '3p' ANALYSIS.md` → "four times."

**Fix:** Change "four times" → "seven times" on line 3 and `experiment-01..04/` → `experiment-01..07/` on line 9.

---

### 4. **README says "5 runs" (×2) — actually 7 experiment directories**
**Severity: MED**

README:12 says `traces/, 5 runs` and README:70 says `5 real runs`. The CHANGELOG and blog correctly say "7 real captured runs" and there are **7 experiment directories** under `traces/`.

**Confirmed by:** `ls -d traces/experiment-0*/ | wc -l` → 7 vs `grep "5 runs\|5 real" README.md`

**Fix:** Change both occurrences of "5 runs" / "5 real runs" → "7 runs" / "7 real runs" in README.md.

---

### 5. **PROVENANCE.md catalogs only experiments 01–04 (missing 05, 06, 07)**
**Severity: MED**

PROVENANCE.md's source table lists S2–S5 (4 trace sources for experiments 01–04) but experiments 05, 06, and 07 — all referenced heavily in ANALYSIS.md §12, §6, and the compare gate — have no provenance entries. This breaks the repo's stated goal of full source traceability.

**Confirmed by:** `grep -c "traces/experiment" PROVENANCE.md` → 4 vs `ls -d traces/experiment-0*/ | wc -l` → 7.

**Fix:** Add S6 (experiment-05), S7 (experiment-06), S8 (experiment-07) entries to PROVENANCE.md with the same schema as S2–S5.

---

### 6. **COMPARISON.md shows stale codex invocation with `--ask-for-approval` (contradicts CHANGELOG fix + code)**
**Severity: MED**

COMPARISON.md:62 lists the invocation as `codex exec --sandbox workspace-write --ask-for-approval never [--output-schema] "<p>"` with column header "invocation (verified)." However:
- CHANGELOG v0.0.2 says: *"this Codex has no `--ask-for-approval`; `--output-schema` takes a file, not inline JSON"*
- The actual `CliAgentBackend.codex()` (cli-agent-backend.ts:175–197) uses `exec --skip-git-repo-check -s <sandbox>` — no `--ask-for-approval` at all.

**Confirmed by:** `grep "ask-for-approval" docs/COMPARISON.md` vs `grep "ask-for-approval" src/cli-agent-backend.ts` (no match) vs CHANGELOG fix note.

**Fix:** Update COMPARISON.md:62 invocation to `codex exec --skip-git-repo-check -s <sandbox> [-m MODEL] "<prompt>"` matching the verified-local flags.

---

### 7. **RUNLOG.md Phase 4 snapshot "6 files, 102 tests" is stale (actual: 14 files, 125 tests)**
**Severity: LOW**

RUNLOG.md:51 says *"PASS — 6 files, 102 tests."* This was accurate at the Phase 4 snapshot but is now stale (14 test files, 125 tests). While RUNLOG is a historical process log and some staleness is expected, the "102 tests" number could mislead a reader checking reproducibility.

**Confirmed by:** `npx vitest run 2>&1 | grep -E "Tests|Test Files"` vs `sed -n '51p' RUNLOG.md`

**Fix:** Add a parenthetical like *(Phase 4 baseline; 125 tests as of current HEAD)* or update to current count.

---

### 8. **goals doc FINAL STATUS says "vitest 102/102" and "163 files" — both stale**
**Severity: LOW**

`docs/goals/reproduce-dynamic-workflows.md:54` says `vitest 102/102` (actual: 125) and line 58 says `163 files` (actual: 264). Same category as finding 7 — historical snapshot that drifted.

**Confirmed by:** `npx vitest run` → 125; `find . -not -path '*/node_modules/*' -type f | wc -l` → 264.

**Fix:** Update the FINAL STATUS section to current numbers or add a note that they reflect the initial completion state.

---

### 9. **ANALYSIS §7 cites unverifiable "usage.subagent_tokens=729176" — not in committed trace data**
**Severity: LOW**

ANALYSIS.md:75 claims *"`traces/experiment-01/task-output.json`: `budgetTotal:null`, `tokensSpent:56533` while `usage.subagent_tokens=729176`."* The `tokensSpent:56533` is confirmed, but `usage.subagent_tokens=729176` does **not exist** in that file (which has keys `summary, agentCount, logs, result` — no `usage`). The number is likely from the real Claude Code session's turn-level usage (not persisted per-run), but as written the claim attributes it to the task-output file, which is inaccurate.

**Confirmed by:** `node -e "const d=JSON.parse(require('fs').readFileSync('traces/experiment-01/task-output.json','utf8')); console.log(Object.keys(d))"` → `['summary','agentCount','logs','result']` — no `usage` key.

**Fix:** Change the citation to note that `subagent_tokens` comes from the session-level usage reporting (not persisted in task-output), or remove the specific number and describe it as "far exceeding this run's output" based on the observable gap.
