import { runWorkflow, CliAgentBackend } from "./dist/index.js";
// WORKERS = GLM-5.1 via ccz
const glm = CliAgentBackend.custom({
  buildCommand: (r) => ({ cmd: "ccz", args: ["--bare", "-p", r.prompt] }),
  timeoutMs: 150000,
});
// SCRIPT authored by the LEADER = this Opus session (no claude CLI needed):
const script = `
export const meta = { name: 'planet-facts', description: 'two GLM workers fetch one fact each, in parallel' };
phase('Facts');
const facts = await parallel([
  () => agent('Give one concise, interesting fact about Mars. Reply with ONLY the fact, one sentence.', { label: 'mars' }),
  () => agent('Give one concise, interesting fact about Jupiter. Reply with ONLY the fact, one sentence.', { label: 'jupiter' }),
]);
return { facts };
`;
console.log("LEADER = this Opus session (authored the script) | WORKERS = GLM-5.1 via ccz ...");
const res = await runWorkflow(script, { backend: glm });
console.log("\n===== RESULT (subagents = real GLM-5.1) =====\n" + JSON.stringify(res.result, null, 2));
console.log("\nagents=" + res.agentCount + " runId=" + res.runId);
