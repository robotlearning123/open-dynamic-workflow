// parent.workflow.js — Wave C boundary probe: parallel/pipeline edge cases + workflow() nesting depth.
export const meta = {
  name: 'trace-boundaries',
  description: 'Wave C: probe parallel/pipeline edge cases (empty, throwing) and workflow() nesting depth (expected 1 level).',
  phases: [{ title: 'Edges' }, { title: 'Nesting' }],
}

phase('Edges')
const emptyParallel = await parallel([])
const emptyPipeline = await pipeline([], (x) => x)
// ASYNC rejection (the documented "resolves to null" case) -> expect [<value>, null].
// NOTE: a SYNCHRONOUS throw in a thunk instead CRASHES the whole workflow (observed in run
// wf_faf90a80-d85: "failed: Error: boom-thunk"). Sync thunk throws are NOT caught by parallel.
const asyncRejectParallel = await parallel([
  () => agent('Reply with ONLY the word: ok', { label: 'ok-agent', phase: 'Edges', model: 'haiku' }),
  () => Promise.reject(new Error('boom-async')),
])
// stage throws on item 'a' -> that item becomes null & skips rest; 'b' completes
const throwingPipeline = await pipeline(['a', 'b'], (item) => { if (item === 'a') throw new Error('boom-stage'); return item + '-done' })

phase('Nesting')
let childResult = null
let parentLevelError = null
try {
  childResult = await workflow({ scriptPath: './traces/experiment-05-boundaries/child.workflow.js' })
} catch (e) {
  parentLevelError = String((e && e.message) || e)
}

return {
  emptyParallel,                 // expect []
  emptyPipeline,                 // expect []
  asyncRejectParallel_len: asyncRejectParallel.length,         // expect 2
  asyncRejectParallel_nullAt1: asyncRejectParallel[1] === null, // expect true (async rejection -> null)
  throwingPipeline,              // expect [null, "b-done"]
  parentLevelError,              // expect null (top workflow calling workflow() is the 1st level => allowed)
  childResult,                   // expect { level:'child', nestedError:<throws>, nestedRan:null }
}
