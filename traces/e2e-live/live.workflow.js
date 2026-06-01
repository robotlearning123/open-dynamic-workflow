// live.workflow.js — REAL end-to-end smoke: run through OUR engine with a real-agent backend.
// Each agent() spawns a real Claude Code process (CliAgentBackend.claude). Proves the headline
// "the basic unit is a real agent" path actually works, not just MockBackend.
export const meta = { name: 'live-e2e', description: 'real-agent end-to-end smoke through the engine', phases: [{ title: 'Fanout' }] }

phase('Fanout')
const r = await parallel([
  () => agent('Reply with ONLY the word: ALPHA', { label: 'alpha', phase: 'Fanout' }),
  () => agent('Reply with ONLY the word: BETA', { label: 'beta', phase: 'Fanout' }),
])
return { results: r.map((s) => (typeof s === 'string' ? s.trim() : s)) }
