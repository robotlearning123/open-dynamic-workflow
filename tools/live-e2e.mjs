// live-e2e.mjs — run the live workflow through the reproduction engine with a REAL agent backend.
// Usage: npm run build && node tools/live-e2e.mjs
// Spawns real `claude -p` subagents (haiku). Writes evidence to traces/e2e-live/result.json.
import { runWorkflowFile, CliAgentBackend, TreeReporter } from "../dist/index.js";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = CliAgentBackend.claude({ model: "claude-haiku-4-5-20251001" });

const r = await runWorkflowFile(join(ROOT, "traces/e2e-live/live.workflow.js"), {
  backend,
  reporter: new TreeReporter(),
  journalDir: join(ROOT, ".runs"),
});

console.log("\nrunId:", r.runId, "| agents:", r.agentCount, "| outputTokens(est):", r.tokensSpent);
console.log("result:", JSON.stringify(r.result));
const ok = Array.isArray(r.result.results) && r.result.results.length === 2;
writeFileSync(
  join(ROOT, "traces/e2e-live/result.json"),
  JSON.stringify({ runId: r.runId, agentCount: r.agentCount, tokensSpent: r.tokensSpent, result: r.result, backend: "CliAgentBackend.claude(haiku)" }, null, 2),
);
console.log(ok ? "\nLIVE E2E OK ✓ — engine drove real Claude Code agents end-to-end" : "\nLIVE E2E FAIL ✗");
process.exit(ok ? 0 : 1);
