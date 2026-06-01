// experiment-01-probe.workflow.js
// PURPOSE: A real, instrumented dynamic-workflow run whose only job is to EXERCISE
// every core primitive and emit ground-truth data we can harvest and analyze, so the
// 1:1 reproduction is grounded in observed behavior rather than assumptions.
//
// Exercised: phase(), parallel() [barrier], pipeline() [no-barrier, (prev,original,index)],
//            agent()+schema [structured output], agent() text, log(), budget.{total,spent,remaining},
//            opts.model override, opts.phase, opts.label.
// Harvested afterwards from the transcript dir: persisted script, agent-<id>.jsonl journals,
// runId, agentCount, tokensSpent, and the returned structured self-report below.

export const meta = {
  name: 'trace-dynamic-workflow',
  description: 'Instrumented real run to capture ground-truth execution data for a 1:1 reproduction of dynamic workflows.',
  phases: [
    { title: 'Fanout', detail: 'parallel() barrier — 3 probes, schema output, mixed models' },
    { title: 'Pipeline', detail: 'pipeline() no-barrier — 2 items x 2 stages (schema then text)' },
    { title: 'Synthesize', detail: 'single agent merges fanout + pipeline into a report' },
  ],
}

// Shared structured-output schema (probes the StructuredOutput forced-tool path).
const OBS = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    primitive: { type: 'string' },
    note: { type: 'string', description: 'at most 6 words' },
  },
  required: ['id', 'primitive', 'note'],
}

log(`[trace] start: budget.total=${budget.total} spent=${budget.spent()} remaining=${budget.remaining()}`)

// --- Phase 1: parallel() — barrier semantics, concurrency, structured output, model override ---
phase('Fanout')
const topics = ['parallel-barrier', 'concurrency-cap', 'schema-output']
const fan = await parallel(
  topics.map((t, i) => () =>
    agent(
      `You are probe #${i}. Return id=${i}, primitive=${JSON.stringify(t)}, and a note of at most 6 words describing what the "${t}" aspect of a dynamic workflow does.`,
      { label: `probe:${t}`, phase: 'Fanout', schema: OBS, model: i === 0 ? 'sonnet' : 'haiku' },
    ),
  ),
)
log(`[trace] fanout ok=${fan.filter(Boolean).length}/${topics.length} spent=${budget.spent()} remaining=${budget.remaining()}`)

// --- Phase 2: pipeline() — no-barrier staging, (prev, original, index) contract ---
phase('Pipeline')
const items = ['stage-semantics', 'no-barrier']
const piped = await pipeline(
  items,
  // Stage 1: prev === original (the item itself). Schema output.
  (item, original, index) =>
    agent(
      `Pipeline stage-1, index=${index}, item=${JSON.stringify(item)}. Return id=${index}, primitive=${JSON.stringify('pipeline:' + item)}, note of at most 6 words.`,
      { label: `pipe1:${item}`, phase: 'Pipeline', schema: OBS, model: 'haiku' },
    ),
  // Stage 2: receives (prevResult, originalItem, index). Text output (no schema).
  (prev, original, index) =>
    agent(
      `Pipeline stage-2, index=${index}, originalItem=${JSON.stringify(original)}. You received this stage-1 JSON: ${JSON.stringify(prev)}. In ONE short sentence, state the originalItem and the stage-1 id you received.`,
      { label: `pipe2:${original}`, phase: 'Pipeline', model: 'haiku' },
    ),
)
log(`[trace] pipeline chains_ok=${piped.filter(Boolean).length}/${items.length} spent=${budget.spent()} remaining=${budget.remaining()}`)

// --- Phase 3: synthesize ---
phase('Synthesize')
const synthesis = await agent(
  `You are the synthesizer. Fanout results: ${JSON.stringify(fan)}. Pipeline results: ${JSON.stringify(piped)}. In at most 3 sentences, summarize which primitives were exercised and whether parallel preserved input order.`,
  { label: 'synthesize', phase: 'Synthesize', model: 'sonnet' },
)

log(`[trace] end: spent=${budget.spent()} remaining=${budget.remaining()}`)

// Structured self-report — itself a data artifact (captured as the run's return value).
return {
  meta_name: 'trace-dynamic-workflow',
  budgetTotal: budget.total,
  tokensSpent: budget.spent(),
  fanoutOrderPreserved: fan.every((r, i) => r && r.id === i),
  fanout: fan,
  pipeline: piped,
  synthesis,
  exercised: ['phase', 'parallel', 'pipeline', 'agent+schema', 'agent+text', 'log', 'budget', 'model-override', 'opts.label', 'opts.phase'],
}
