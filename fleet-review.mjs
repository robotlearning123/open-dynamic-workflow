import { runWorkflow, CliAgentBackend, silentReporter } from "./dist/index.js";
import { mkdirSync, writeFileSync } from "node:fs";

// WORKERS: ccz + ccxm (both GLM-family free agents), routed by opts.model. LEADER = Opus (this script).
const fleet = CliAgentBackend.custom({
  buildCommand: (req) => ({ cmd: req.model === "ccxm" ? "ccxm" : "ccz", args: ["--bare", "-p", req.prompt] }),
  timeoutMs: 120000,
});

const WAVES = {
  "1-correctness": ["src/runner.ts","src/primitives.ts","src/journal.ts chainKey","src/concurrency.ts Limiter","src/backend.ts","src/cli-agent-backend.ts","src/http-agent-backend.ts","src/author.ts","src/cli.ts","src/worktree.ts"],
  "2-security": ["vm sandbox escape via .constructor","CliAgentBackend arg/prompt injection","process.env inheritance to children","runId/resumeFromRunId path traversal","workflow() new Function host realm","authorWorkflow trusting author output","HttpAgentBackend SSRF/timeout","spawned-agent stderr secret leak","parseMeta getter DoS","journal write-path safety"],
  "3-author-layer": ["authorWorkflow happy path","extractScript multi-fence pick","extractScript no-meta fallback","parseMeta validation gate","dryRun returns script only","runBackend defaults to authorBackend","authorModel passthrough","prompt-injection via task","error-message quality","TS types soundness"],
  "4-docs-accuracy": ["README.md","SPEC.md","ANALYSIS.md","docs/PARITY.md","docs/COMPARISON.md","SECURITY.md","RUNLOG.md","PROVENANCE.md","docs/blog mechanism section","CHANGELOG.md"],
  "5-claims": ["34/34 gate is real","142 test count","~91% coverage","'1:1' not overclaimed","live-verified e2e evidence","Kimi 300 sub-agents sourcing","Manus 20 subtasks sourcing","budget run-scoped honesty","cores-2 provenance","author-layer 'not bound to Claude' claim"],
  "6-tests": ["runner.test","primitives.test","journal.test","concurrency.test","backend+tools.test","cli-agent-backend.test","http-agent-backend.test","author.test","cli.test","progress/structured-output.test"],
  "7-api-dx": ["runWorkflow ergonomics","runWorkflowFile","authorWorkflow shape","CliAgentBackend presets","HttpAgentBackend","MockBackend","AnthropicBackend","parseMeta","Journal/resume API","types.ts ergonomics"],
  "8-comparison": ["vs raw official workflow","vs Kimi K2.6 swarm","vs Manus Wide Research","vs LangGraph/CrewAI","Opus-leader+GLM-worker story","authoring-layer gap vs raw","resume superset claim","offline MockBackend advantage","multi-vendor claim","positioning honesty"],
  "9-release": ["package.json files/exports/bin","npm pack contents","version consistency","CI ci.yml","examples shipped+run","LICENSE+trademark","engines node>=20","README links resolve",".gitignore coverage","prepublishOnly hook"],
  "10-meta-risk": ["biggest correctness risk","biggest security risk","what HN attacks first","author-layer limitations","what raw does better","missing feature for parity","test blind spots","remaining overclaim","non-determinism risks","highest-value next fix"],
};

const script = `
export const meta = { name: 'fleet-review-100', description: '10 waves x 10 GLM (ccz/ccxm) agents review/analyze/check the repo' };
const WAVES = ${JSON.stringify(WAVES)};
const out = {};
for (const [theme, targets] of Object.entries(WAVES)) {
  phase(theme);
  out[theme] = await parallel(targets.map((t, i) => () => agent(
    'Review/analyze/check this repo (open-dynamic-workflow), a TS reproduction of Claude Code dynamic workflows. WAVE=' + theme + ' TARGET=' + t + '. Read the relevant file(s) yourself with your tools. Reply with ONE concrete finding (bug / security risk / overclaim / gap) OR "OK: <one-line why>". Be terse (<=2 sentences). Cite file:line if you can. Do not fabricate.',
    { label: theme + ' :: ' + t, model: (i % 2 === 0 ? 'ccxm' : 'ccz') }
  )));
}
return out;
`;

console.log("FLEET launching: 10 waves x 10 ccz/ccxm agents (concurrency 10)...");
const res = await runWorkflow(script, { backend: fleet, reporter: silentReporter, concurrency: 10 });
mkdirSync(".runs", { recursive: true });
const outPath = ".runs/fleet-review.json";
writeFileSync(outPath, JSON.stringify(res.result, null, 2));
const flat = Object.values(res.result).flat();
const ok = flat.filter((x) => x !== null && x !== undefined).length;
console.log("FLEET DONE agents=" + res.agentCount + " ok=" + ok + "/" + flat.length + " runId=" + res.runId + " -> " + outPath);
