// experiment-03-concurrency.workflow.js
// PURPOSE: Empirically reveal the concurrency cap. cores=32 on this host => expected
// cap = min(16, cores-2) = 16. Launch N=30 trivial parallel agents and harvest start
// timestamps: if the cap holds, only ~16 run at once and agents 17..30 start only after
// earlier ones finish (visible as a second start-time cluster).
// Outputs are ~1 token each to keep cost low while still exercising the real scheduler.

export const meta = {
  name: 'trace-concurrency-cap',
  description: 'Stress probe: N parallel trivial agents to measure the concurrency cap via start-time clustering.',
  phases: [{ title: 'Saturate', detail: 'parallel() of N trivial haiku agents' }],
}

const N = 30
log(`[cap] launching ${N} parallel agents; expected cap=min(16,cores-2)`)
phase('Saturate')
const res = await parallel(
  Array.from({ length: N }, (_, i) => () =>
    agent(`Reply with ONLY the integer ${i} and nothing else.`, { label: `c${String(i).padStart(2, '0')}`, phase: 'Saturate', model: 'haiku' }),
  ),
)
const ok = res.filter((r) => r !== null).length
log(`[cap] done ok=${ok}/${N} spent=${budget.spent()}`)
return { N, ok, sample: res.slice(0, 6) }
