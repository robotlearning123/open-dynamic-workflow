# Contributing

Thanks for helping! This project has one non-negotiable rule: **1:1 fidelity first.**

## Setup
```bash
npm install && npm run build && npm test
node tools/compare.mjs    # OURS vs CLAUDE must stay 34/34 = 100%
```

## The fidelity discipline
- `tools/compare.mjs` is the gate (also runs in CI). Any change that lowers it below 100% is a regression — fix the engine, not the test.
- Behavioral claims must be backed by a real trace under `traces/`. To capture one with Claude Code's real Workflow tool:
  ```
  Workflow({ scriptPath: "traces/your-probe.workflow.js" })
  python3 tools/harvest_trace.py <printed transcript dir>
  ```
  Then add the finding (with the citing artifact) to `ANALYSIS.md` and, if it's a new behavior, a test.

## Adding an agent backend (the basic unit is pluggable)
Implement `AgentBackend` (`run(req) => { output, inputTokens, outputTokens }`). See `src/cli-agent-backend.ts` (local processes) and `src/http-agent-backend.ts` (cloud). Keep `run` deterministic enough to unit-test with an injected client/`fetch`/command (no network, no real agent in tests).

## Conventions
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`…), one concern per PR.
- Develop on a branch (never `main`/`master`); open a PR.
- Keep `npm run typecheck`, `npm test`, and `node tools/compare.mjs` green.
- Track parity in `docs/PARITY.md` — move items from 🔜 to ✅ with evidence.
