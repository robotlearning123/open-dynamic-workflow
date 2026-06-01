# PROVENANCE — source traceability

Every factual claim in this repo traces to one of the sources below. Reproduction code
mirrors **observed behavior**, not undisclosed internals (see `ANALYSIS.md` §11).

| # | Source | Type | Retrieved | Method | Cited in |
|---|--------|------|-----------|--------|----------|
| S1 | https://claude.com/blog/introducing-dynamic-workflows-in-claude-code | Official blog (concepts; no code) | 2026-05-28 | WebFetch | ANALYSIS §1; README |
| S2 | `traces/experiment-01/` (run `wf_69d4a9ee-399`) | Real working log | 2026-05-28 | Workflow tool + harvest_trace.py | ANALYSIS §2–5,§7,§8 |
| S3 | `traces/experiment-02-resume/` | Real working log (resume) | 2026-05-28 | Workflow tool resume + prompt diff | ANALYSIS §6; FINDING-resume-semantics.md |
| S4 | `traces/experiment-03-concurrency/` (run `wf_877f036c-f7f`) | Real working log | 2026-05-28 | Workflow tool + sweep-line analysis | ANALYSIS §3.3 |
| S5 | `traces/experiment-04-sandbox/` (run `wf_a230b6ea-be1`) | Real working log | 2026-05-28 | Workflow tool (0-agent probe) | ANALYSIS §9 |
| S5a | `traces/experiment-05-boundaries/` (run `wf_f8c8d665-114`, + failed `wf_faf90a80-d85`) | Real working log | 2026-05-28 | Workflow tool (nesting + parallel/pipeline edge probes) | ANALYSIS §12 |
| S5b | `traces/experiment-06/` (run `wf_e2bf21db-09e` + resume) | Real working log (resume model) | 2026-05-28 | Workflow tool resume + prompt/key diff | ANALYSIS §6; FINDING-resume-model.md |
| S5c | `traces/experiment-07-compose/` (run `wf_6c59a32d-748`) | Real working log | 2026-05-28 | Workflow tool (pipeline→parallel composition) | ANALYSIS exp index; compare "composition" |
| S5d | `traces/e2e-live/` (run `wf_0e550857c949`) | Real working log (live e2e) | 2026-05-28 | OUR engine + `CliAgentBackend.claude()` (real `claude -p`) | README "live-verified"; RUNLOG Phase 5 |
| S6 | context7 `/anthropics/anthropic-sdk-typescript` | SDK docs | 2026-05-28 | context7 query-docs | SPEC "Verified Anthropic SDK contract"; src/backend.ts |
| S7 | Claude Code Workflow tool documentation (this session's system prompt) | Tool reference | 2026-05-28 | in-context | SPEC; primitives/runner semantics |
| S8 | `npm view <pkg> version` | Registry | 2026-05-28 | npm CLI | package.json dep versions |
| S9 | Claude official docs — code.claude.com/docs (workflows, sub-agents, agent-teams, worktrees, cli-reference, changelog) + platform.claude.com/docs (managed-agents overview + multi-agent) | Official docs | 2026-05-28 | research agent via WebFetch | ANALYSIS §13; docs/COMPARISON.md; README |
| S10 | Competitor repos/docs (LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK, claude-flow/Ruflo, claude-squad, Mastra, OpenHands, multica, paperclip, wanman, cofounder) | Public repos | 2026-05-28 | research agents via WebFetch (star counts verified that day) | docs/COMPARISON.md; research/ |
| S11 | Managed/cloud agent platform docs — OpenAI (Responses API, Codex CLI reference), Google Vertex AI Agent Engine (reasoningEngines REST), AWS Bedrock Agents + AgentCore + Strands, Claude Managed Agents | Official docs | 2026-05-28 | research agent via WebFetch | docs/COMPARISON.md §5–6; CliAgentBackend.codex |

## Verifiability
- Raw logs (S2–S5) are committed under `traces/` exactly as harvested — re-run
  `python3 tools/harvest_trace.py <run_dir>` to regenerate the digests.
- Behavioral claims are re-checkable against the reproduction via `node tools/crosscheck.mjs`
  and `npm test`.

## Known unverifiable / boundary items (labeled, not guessed)
- The exact preimage of the `v2:<sha256>` cache key is **internal** — we reproduce the observable
  hit/miss behavior, not byte-identical hashes. (ANALYSIS §6, §11)
- `budget.spent()` turn-global scope is inferred from the spent≫subagent-output gap in S2; the
  reproduction uses run-scoped output-token accounting (same observable contract). (ANALYSIS §7, §11)
- The subagent's full toolset is Claude Code's own; the standalone engine reproduces the
  orchestration layer, modeling the subagent as a Claude API call (+ optional tools). (ANALYSIS §8, §11)
