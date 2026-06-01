// experiment-06-resume-model.workflow.js
// PURPOSE: Distinguish PREFIX vs CONTENT-ADDRESSED resume. Four SEQUENTIAL, INDEPENDENT agents
// (no agent's prompt embeds another's output), deterministic invocation order A,B,C,D.
// Protocol: run once; then edit ONLY agent B's prompt (B1 -> B2) and resume.
//   - PREFIX model            => B, C, D all re-run (everything after the first changed call).
//   - CONTENT-ADDRESSED model => only B re-runs (A, C, D keys unchanged -> served from cache).
// Harvest the journal delta to see which agentIds got new started/result events.

export const meta = {
  name: 'trace-resume-model',
  description: 'Distinguish prefix vs content-addressed resume: 4 independent sequential agents; edit the 2nd and resume.',
  phases: [{ title: 'Seq' }],
}

phase('Seq')
const a = await agent('Reply with ONLY the token: A1', { label: 'A', phase: 'Seq', model: 'haiku' })
const b = await agent('Reply with ONLY the token: B2', { label: 'B', phase: 'Seq', model: 'haiku' })
const c = await agent('Reply with ONLY the token: C1', { label: 'C', phase: 'Seq', model: 'haiku' })
const d = await agent('Reply with ONLY the token: D1', { label: 'D', phase: 'Seq', model: 'haiku' })
return { a, b, c, d }
