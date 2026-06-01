// ultra-qa-review.workflow.js — ultracode-effort adversarial QA sweep.
// 6 independent review lenses (each EXECUTES dist/ to confirm), then every finding is adversarially
// REFUTED by a second agent (kept only if it survives), then synthesized. Opus throughout.

export const meta = {
  name: 'ultra-qa-review',
  description: 'Multi-lens adversarial review of the engine with per-finding refutation + synthesis.',
  phases: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

const ROOT = (args && args.root) || '<repo-root>'

const FINDINGS = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['HIGH', 'MED', 'LOW'] },
          file: { type: 'string' },
          line: { type: 'string' },
          claim: { type: 'string' },
          howConfirmed: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['id', 'severity', 'file', 'claim', 'howConfirmed', 'fix'],
      },
    },
  },
  required: ['dimension', 'findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    confirmed: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['id', 'confirmed', 'reason'],
}

const PRE = `You are an ADVERSARIAL reviewer of the repo at ${ROOT} (an open reproduction of Claude Code dynamic workflows; build is current in dist/).
RULES:
- CONFIRM every defect by EXECUTING it (read the code, then run \`node -e '...'\` against dist/, or run \`npx vitest run\`), not by speculation. Put the exact command/observation in howConfirmed. Cite file:line. Severity HIGH/MED/LOW. Give a concrete fix. Do NOT fabricate.
- ALREADY FIXED — do NOT re-report: (1) node:vm is not a security boundary (now documented in SECURITY.md), (2) CliAgentBackend stdin-EPIPE handling, (3) reject on ANY non-zero exit, (4) AnthropicBackend throws on schema-retry/maxToolTurns exhaustion, (5) parseMeta blanks comments, (6) stripExports handles indentation + leaves export default, (7) validate rejects NaN/Infinity, (8) budget documented as best-effort gate, (9) resume lookup before the limiter.
- Report only NEW, real defects in YOUR dimension. Empty findings is a fine answer if you find none after genuinely trying.`

const DIMS = [
  { key: 'concurrency-primitives', focus: 'src/concurrency.ts + src/primitives.ts: Limiter FIFO/cap/queue edge cases (acquire/release races, exceptions inside run() leaking a slot), parallel() barrier+order with mixed sync/async, pipeline() per-item independence + stage exceptions, chained-key determinism/collisions, workflow() nested-context sharing (depth, counters, journal), budget accounting under concurrency beyond the documented gate. Execute scenarios with dist + a fake backend.' },
  { key: 'backends', focus: 'src/backend.ts + cli-agent-backend.ts + http-agent-backend.ts: AnthropicBackend tool-use loop termination (duplicate tool_use ids, tool that returns non-string, unknown tool name), MockBackend schema-faker for enum/nested-object/array-of-objects/required edge cases, HttpAgentBackend response parsing + AbortController cleanup + non-JSON body, CliAgentBackend extractJson on adversarial stdout (huge output, fenced+prose, arrays). Execute with injected clients/fetch/commands.' },
  { key: 'runner-sandbox', focus: 'src/runner.ts: meta parsing on regex literals (/\\}/), nested templates, an object literal containing a string with the text "export const meta =", multiple meta declarations; stripExports corrupting a line-leading string literal "export x"; SAFE_MATH/SAFE_DATE completeness (Math.max, Date.parse/UTC, new Date(arg).getTime); runId collisions; vm compile-error + runtime-error propagation; top-level await + return interplay. Execute via runWorkflow on crafted sources.' },
  { key: 'tests-coverage', focus: 'test/*.test.ts + tools/compare.mjs + crosscheck.mjs: are any tests tautological or asserting the wrong thing? Do compare.mjs assertions truly verify fidelity vs just shape? Run \`npx vitest run --coverage --coverage.include=src/**\` and name the most important UNCOVERED branches (not just %). Identify missing negative/error-path tests. Propose the specific tests to add.' },
  { key: 'docs-claims', focus: 'README.md, ANALYSIS.md, PARITY.md, COMPARISON.md, SPEC.md, CHANGELOG.md, docs/blog/*: adversarially check EVERY quantitative/behavioral claim against the code + traces. Flag stale numbers (e.g. test counts like "107 tests" vs the current vitest count), overclaims, links that 404 locally, and any statement the code contradicts. Run vitest to get the real test count.' },
  { key: 'examples-packaging', focus: 'examples/*.js + src/cli.ts + package.json + tsconfig*: do all examples run under MockBackend (run them: node dist/cli.js examples/X.js --mock)? Is loop-until-dry guaranteed to terminate? CLI edge cases. \`npm pack --dry-run\` contents (does it ship dist + omit traces/src/test?). package.json exports/bin/types correctness; does \`node -e "import(...dist/index.js)"\` expose the documented API? Execute everything.' },
]

phase('Review')
const reviewed = await pipeline(
  DIMS,
  (d) => agent(`${PRE}\n\nDIMENSION: ${d.key}\nFOCUS: ${d.focus}`, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS, model: 'sonnet'}),
  (rev, d) =>
    parallel(
      ((rev && rev.findings) || []).map((f) => () =>
        agent(
          `You are a SKEPTIC trying to REFUTE this reported defect in ${ROOT}. Reproduce it by executing (node -e against dist/, or run the test). If you CANNOT reproduce it, or it's already-fixed/by-design/not-a-defect, set confirmed=false. Only confirmed=true if you reproduced it yourself.\nFinding ${f.id} [${f.severity}] ${f.file}: ${f.claim}\nHow the reporter says they confirmed: ${f.howConfirmed}`,
          { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT, model: 'sonnet'},
        ).then((v) => ({ ...f, verdict: v })),
      ),
    ).then((verified) => ({ dimension: d.key, verified })),
)

phase('Synthesize')
const confirmed = reviewed
  .filter(Boolean)
  .flatMap((r) => (r.verified || []).filter((f) => f.verdict && f.verdict.confirmed))

return {
  byDimension: reviewed.map((r) => (r ? { dimension: r.dimension, total: (r.verified || []).length, confirmed: (r.verified || []).filter((f) => f.verdict && f.verdict.confirmed).length } : null)),
  confirmed: confirmed.map((f) => ({ id: f.id, severity: f.severity, file: f.file, line: f.line, claim: f.claim, fix: f.fix, reason: f.verdict.reason })),
}
