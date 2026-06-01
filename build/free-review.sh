#!/usr/bin/env bash
# Large-scale adversarial review on FREE cross-model workers (ccz=GLM, ccxm=other), in parallel.
# Each worker reads/executes the repo and writes a markdown findings file to review/.
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p review

PRE="You are an ADVERSARIAL code reviewer of this repository (an open-source reproduction of Claude Code dynamic workflows; the built output is in dist/). \
CONFIRM every defect by READING the code and/or RUNNING it (node -e against dist/, or 'npx vitest run') — do not speculate; put the exact command/observation under 'confirmed by'. \
Cite file:line. Mark severity HIGH/MED/LOW. Give a concrete fix. Do NOT fabricate; if you cannot confirm it, do not report it. \
ALREADY FIXED — do NOT re-report: (1) node:vm is not a security boundary (documented in SECURITY.md), (2) CliAgentBackend stdin EPIPE handling, (3) reject on ANY non-zero exit, (4) AnthropicBackend throws on schema-retry/maxToolTurns exhaustion, (5) parseMeta blanks comments, (6) stripExports indentation + leaves export default, (7) validate rejects NaN/Infinity, (8) budget documented best-effort, (9) resume lookup before limiter. \
Report ONLY new, verified defects in your dimension as a concise markdown list; 'no findings' is an acceptable answer."

run() { # $1=worker  $2=dim  $3=focus
  "$1" -p --bare --dangerously-skip-permissions "$PRE

DIMENSION: $2
FOCUS: $3" < /dev/null > "review/$2.md" 2>&1 &
}

run ccz  concurrency-primitives "src/concurrency.ts + src/primitives.ts: Limiter FIFO/cap (does an exception inside run() leak a slot? acquire/release races), parallel() barrier+order with mixed sync/async thunks, pipeline() per-item independence + stage exceptions, chained-key determinism/collisions, workflow() nested context sharing (depth/counters/journal), budget accounting under concurrency."
run ccxm backends               "src/backend.ts + src/cli-agent-backend.ts + src/http-agent-backend.ts: AnthropicBackend tool-loop termination (duplicate tool_use ids, non-string tool return, unknown tool), MockBackend schema-faker for enum/nested/array-of-objects/required, HttpAgentBackend parse + AbortController cleanup + non-JSON body, CliAgentBackend extractJson on adversarial stdout."
run ccz  runner-sandbox         "src/runner.ts: meta parsing on regex literals, nested templates, a string literal containing 'export const meta =', multiple meta declarations; SAFE_MATH/SAFE_DATE completeness (Math.max, Date.parse/UTC, new Date(arg)); runId collisions; vm compile/runtime error propagation; top-level await + return."
run ccxm tests-coverage         "test/*.test.ts + tools/compare.mjs + tools/crosscheck.mjs: any tautological/wrong assertions? does compare.mjs truly verify fidelity vs shape? run 'npx vitest run --coverage --coverage.include=src/**' and name the most important UNCOVERED branches + missing negative tests."
run ccz  docs-claims            "README.md, ANALYSIS.md, PARITY.md, COMPARISON.md, SPEC.md, CHANGELOG.md, docs/blog/*: adversarially check EVERY quantitative/behavioral claim vs the code + traces. Flag stale numbers (e.g. test counts), overclaims, broken local links. Run 'npx vitest run' to get the real test count."
run ccxm examples-packaging     "examples/*.js + src/cli.ts + package.json + tsconfig*: do all examples run under MockBackend ('node dist/cli.js examples/X.js --mock')? is loop-until-dry guaranteed to terminate? 'npm pack --dry-run' contents (ships dist, omits traces/src/test?). package.json exports/bin/types correctness."

wait
echo "free-review done: wrote $(ls review/*.md 2>/dev/null | wc -l) findings files"
