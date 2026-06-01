// experiment-04-sandbox.workflow.js
// PURPOSE: Empirically verify the script SANDBOX contract (0 agents, ~free). The doc says
// Date.now()/Math.random()/argless new Date() throw (to keep resume cache keys stable),
// while Math otherwise works and there's no fs/Node access. Probe each and report.

export const meta = {
  name: 'trace-sandbox',
  description: 'Probe which script-sandbox globals are blocked vs allowed (Date/Math/require/process/fetch).',
  phases: [{ title: 'Probe' }],
}

function probe(label, fn) {
  try {
    return { label, ok: true, value: String(fn()) };
  } catch (e) {
    return { label, ok: false, error: String((e && e.message) || e) };
  }
}

phase('Probe')
const results = [
  probe('Date.now()', () => Date.now()),
  probe('new Date()', () => new Date().toISOString()),
  probe('new Date(0)', () => new Date(0).toISOString()),
  probe('Math.random()', () => Math.random()),
  probe('Math.floor(1.7)', () => Math.floor(1.7)),
  probe('JSON ok', () => JSON.stringify({ a: 1 })),
  probe('typeof require', () => typeof require),
  probe('typeof process', () => typeof process),
  probe('typeof globalThis', () => typeof globalThis),
  probe('typeof fetch', () => typeof fetch),
  probe('typeof agent', () => typeof agent),
  probe('typeof parallel', () => typeof parallel),
  probe('typeof pipeline', () => typeof pipeline),
  probe('typeof budget', () => typeof budget),
]
log('[sandbox] ' + JSON.stringify(results))
return { results }
