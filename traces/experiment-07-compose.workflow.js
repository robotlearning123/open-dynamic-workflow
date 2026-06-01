// experiment-07-compose.workflow.js
// PURPOSE: Reproduce + compare the FLAGSHIP composition — a pipeline whose stage-2 is itself a
// parallel() (the canonical "review -> verify each finding" shape). Exercises: pipeline staging,
// schema at stage-1, a nested parallel of schema agents at stage-2, and result threading
// (stage-2 receives stage-1's structured output as `prev`). 2 dims x 2 verifiers = 4 + 2 = 6 agents.

export const meta = {
  name: 'trace-compose',
  description: 'pipeline whose stage-2 is a parallel (canonical review->verify); verify composition + nested schema + result threading.',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}

const FINDINGS = {
  type: 'object',
  properties: { id: { type: 'integer' }, dim: { type: 'string' } },
  required: ['id', 'dim'],
}
const VERDICT = {
  type: 'object',
  properties: { ref: { type: 'string' }, ok: { type: 'boolean' } },
  required: ['ref', 'ok'],
}

phase('Review')
const dims = ['style', 'perf']
const out = await pipeline(
  dims,
  // stage-1: review each dimension -> structured finding
  (dim, original, index) =>
    agent(`Review dimension "${dim}" (index ${index}). Return id=${index} and dim="${dim}".`, {
      label: `review:${dim}`,
      phase: 'Review',
      schema: FINDINGS,
      model: 'haiku',
    }),
  // stage-2: a PARALLEL of verifiers over a fixed 2-item set (deterministic structure); each gets
  // the stage-1 finding as `prev` and the original dim.
  (prev, dim, index) =>
    parallel(
      ['p', 'q'].map((tag) => () =>
        agent(
          `Verify check "${tag}" for dimension "${dim}" (stage-1 id=${prev.id}). Return ref="${dim}-${tag}", ok=true.`,
          { label: `verify:${dim}-${tag}`, phase: 'Verify', schema: VERDICT, model: 'haiku' },
        ),
      ),
    ),
)

return {
  shape: out.map((r) => (Array.isArray(r) ? r.length : 'NOT-ARRAY')), // expect [2, 2]
  out,
}
