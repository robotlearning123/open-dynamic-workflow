// grandchild.workflow.js — should NOT run if nesting is capped at one level.
export const meta = { name: 'gc', description: 'grandchild — runs only if 2-level nesting were allowed' }
return { ran: 'grandchild' }
