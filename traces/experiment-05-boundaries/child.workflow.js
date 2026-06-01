// child.workflow.js — invoked by the parent (1st level). Tries to nest a grandchild (2nd level),
// which the doc says must throw ("Nesting is one level only").
export const meta = { name: 'child', description: 'child workflow — attempts a 2nd-level nested workflow() (expected to throw)' }
let nestedError = null
let nestedRan = null
try {
  nestedRan = await workflow({ scriptPath: './traces/experiment-05-boundaries/grandchild.workflow.js' })
} catch (e) {
  nestedError = String((e && e.message) || e)
}
return { level: 'child', nestedRan, nestedError }
