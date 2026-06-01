# Comparison: ours vs raw Claude · vs the field

Synthesized from three parallel research agents (2026-05-28): Claude **official** docs, **mainstream** orchestration frameworks (star counts WebFetch-verified that day), and the **named niche** projects. Raw artifacts: `research/competitive-landscape/`. Honest accounting of raw-feature coverage: `PARITY.md`.

## TL;DR — our niche (what nobody else does)
1. **Only project that verifies behavioral fidelity to a real engine** — `tools/compare.mjs` asserts our behavior == captured Claude traces (34/34). Everyone else designs their own semantics.
2. **The basic unit is a pluggable *real agent*** (`CliAgentBackend` spawns `claude`/`codex`/`opencode`/`ccz` (cx/cursor via `.custom()`); `HttpAgentBackend` = cloud). Most frameworks' unit is an LLM call.
3. **TypeScript-native + a deterministic `MockBackend`** for offline/CI testing — unique (Mastra is TS too but has no mock-agent).
4. **Journal-resume with prefix-chained-key semantics** reproducing concurrent partial-replay — unmatched.

## 1. Ours vs RAW (Claude Code dynamic workflows)
Official canonical doc: <https://code.claude.com/docs/en/workflows>. Verified facts and how we line up:

| aspect | raw (official) | ours |
|---|---|---|
| concurrency cap | **16** ("fewer on limited CPU") | `min(16,cores-2)` (measured 16/32 cores; `-2` from the in-product tool reference, not public docs) |
| lifetime cap | **1000 agents/run** | `MAX_TOTAL_AGENTS=1000` (enforced + tested) |
| resume | **same-session only**; next session starts fresh | journal-based **cross-session** replay → a **superset** (we persist `journal.jsonl`) |
| script API names | **not published** in public docs | observed by *running* the real tool (execution-verified) + the in-product tool reference; we match observed behavior, not a published spec |
| runtime | "isolated environment", no fs/shell from script | Node `vm` sandbox (our impl choice; Date/Math/require blocked — verified behavior) |
| availability | only inside Claude Code | standalone npm lib anywhere |
| agent unit | Claude Code itself | pluggable (incl. `CliAgentBackend.claude()` → literally Claude Code) |

**Cloud counterpart (official):** the [Managed Agents API](https://platform.claude.com/docs/en/managed-agents/multi-agent.md) is Anthropic's hosted multi-agent product — `multiagent.coordinator`, **25 concurrent threads**, **depth-1 delegation** (matches our `workflow()` 1-level nesting), `type:"self"`. Our `HttpAgentBackend` is the natural open client for this "cloud unit".

## 2. Ours vs mainstream frameworks (stars WebFetch-verified 2026-05-28)
| framework | ★ | model | real CLI-agent unit | resume | fidelity-verified | lang |
|---|---|---|---|---|---|---|
| [LangGraph](https://github.com/langchain-ai/langgraph) | 33.3k | graph/state-machine | no (LLM+tools) | first-class | no | Py(+JS) |
| [CrewAI](https://github.com/crewAIInc/crewAI) | 52.4k | role-based crew | no | basic | no | Py |
| [AutoGen](https://github.com/microsoft/autogen)/[AG2](https://github.com/ag2ai/ag2) | 58.5k/4.6k | conversation-actor | Docker exec | weak | no | Py |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | 26.7k | handoff chains | SandboxAgent | sessions | no | Py |
| [claude-flow/Ruflo](https://github.com/ruvnet/claude-flow) | 56.1k | swarm/MCP | via CLI (quality [contested](https://www.reddit.com/r/ClaudeAI/comments/1sckiy8/do_not_install_ruflo_into_your_claude_code/)) | some | **no** | TS |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | 7.7k | TUI session mgr | yes (manual) | manual | no | Go |
| [Mastra](https://github.com/mastra-ai/mastra) | 24.5k | `.then/.parallel` DAG | no | suspend/resume | no | TS |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | 75.2k | dev-agent platform | yes | yes | no | Py |
| **open-dynamic-workflow** | new | **script-driven, Claude-1:1** | **yes (pluggable, universal)** | **journal+chained-key** | **yes (34/34)** | **TS** |

Closest competitor = **Mastra** (TS, `.parallel()` DAG) — but its unit is an LLM call, not a real agent process, and it has no fidelity gate or mock-agent. We are the "show-your-work, agent-is-a-real-process" option.

## 3. Ours vs the named niche projects (layered, mostly complementary)
| project | ★(reported) | what it is | relation to us |
|---|---|---|---|
| [multica](https://github.com/multica-ai/multica) | ~28.9k | agent Kanban / management layer | sits **above** us (would consume an orchestration runtime) |
| [paperclip](https://github.com/paperclipai/paperclip) | ~53k | agent org-chart / governance | sits **above** us (delegates to agents that run workflows) |
| [wanman](https://github.com/chekusu/wanman) | OSS | process-per-agent runtime, **git-worktree + isolated $HOME**, JSON-RPC supervisor | **substrate below** us — complementary; we define *what/when*, wanman *executes in isolation* |
| [cofounder](https://github.com/nraiden/cofounder) | OSS | full-stack app generator w/ internal YAML-node DAG | **closest in shape**, but DAG hard-bound to "build an app"; we expose orchestration as a reusable primitive |

Other real Claude-orchestration projects: [ccswarm](https://github.com/nwiizo/ccswarm) (Rust, worktree-isolated), [parruda/swarm](https://github.com/parruda/swarm) (Ruby), and Anthropic-native **agent teams / worktrees** (<https://code.claude.com/docs/en/agent-teams>, <https://code.claude.com/docs/en/worktrees>).

**Open coding-agent CLIs are our `CliAgentBackend` units, not competitors:** [OpenCode](https://opencode.ai) (`opencode run`, provider-agnostic) is targeted by `CliAgentBackend.opencode()`. [oh-my-opencode](https://github.com/opensoft/oh-my-opencode) (transitioning to [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)) bolts **async subagents + a Claude-Code-compat layer** *onto* OpenCode as a single-host plugin — strong evidence of demand for "Claude-style dynamic workflows in open agents," but bound to OpenCode. We orchestrate OpenCode (with or without that plugin, via `--pure`) as **one backend among many**, vendor-neutral.

## 4. Where we are weaker (honest)
No web UI / graph viz · no built-in observability (LangSmith/AgentOps) · no Python API · no hosted platform · no role/persona or conversation-loop pattern · `vm` sandbox is Node-only · smallest community (new). Roadmap to close the orchestration-feature gaps: `PARITY.md` §4.

## 5. Managed / cloud agent platforms — which of our backends targets each (official URLs)
The big vendors ship hosted "agent runners". Our point: we are the **orchestration layer**; any of these is just a **backend**. (Invocation shapes verified by research agent, 2026-05-28.)

| platform | local/cloud | our backend | invocation (verified) |
|---|---|---|---|
| [OpenAI Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) | cloud | `HttpAgentBackend` (**simplest** — stateless, Bearer) | `POST /v1/responses {model,input}` |
| [OpenAI Codex CLI](https://developers.openai.com/codex/cli/reference) | local | `CliAgentBackend.codex()` (**built-in preset**) | `codex exec --skip-git-repo-check -s <sandbox> [-m MODEL] "<prompt>"` (locally-verified flags) |
| [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) | cloud | `HttpAgentBackend` + 3-step adapter | create agent → create session → POST events → SSE stream (`anthropic-beta: managed-agents-2026-04-01`) |
| [Google Vertex AI Agent Engine](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview) | cloud | `HttpAgentBackend` + Google-auth adapter | `POST …/reasoningEngines/{id}:query` |
| [AWS Bedrock Agents](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_InvokeAgent.html) / [AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-invoke-agent.html) | cloud | `HttpAgentBackend` + SigV4 adapter | session-scoped `/…/text` or `/invocations` |
| AWS Strands (local) | local | `CliAgentBackend` (wrap as CLI) | `strands` python agent |

Two gradients that explain why our `HttpAgentBackend` is generic with `buildBody`/`buildHeaders`/`parseResponse` hooks: **auth** OpenAI(Bearer) < Anthropic(x-api-key) < Google(OAuth) < AWS(SigV4); **lifecycle** OpenAI Responses (1 call) < Vertex (1 call post-deploy) < Bedrock (session) < Claude Managed (3-step). Only OpenAI Responses is a clean `POST {prompt}→{output}`.

## 6. Positioning — where RAW sits, where WE sit, vs all

**Capability is the first-order test** — open/portable is meaningless if the capability isn't there. On capability we hold: **orchestration is 1:1** (full primitive set, 34/34) and the **unit can *be* the strongest real agent** (`CliAgentBackend.claude/codex/opencode` literally spawn them), so per-agent power **equals** raw, and a **mixed fleet (Claude + Codex + OpenCode + cloud) exceeds** raw's Claude-only fleet. Where raw still leads is **UX/integration** — live TUI, IDE buttons, `ultracode` auto-authoring, battle-tested scale — *not* core capability. With capability established, the openness/portability axis is the bonus.

Two axes that matter: **openness/portability** (closed/vendor-locked ↔ open/portable) and **orchestration style** (you-bring-orchestration *hosted runtime* ↔ *dynamic script that fans out real agents*).

```
                         OPEN / portable / multi-vendor
                                      ▲
  open frameworks (LLM-call unit)     │     ★ open-dynamic-workflow (OURS)
  LangGraph·CrewAI·AutoGen·Mastra     │     open + dynamic-script + real-agent unit,
  open agent managers (real agent):   │     verified 1:1, and drives EVERYTHING
  claude-squad (manual)·wanman(substrate)   left↔right as a pluggable backend
  ──────────────────────────────────────────┼──────────────────────────────────────▶
  hosted runtime (you bring orchestration)   │   dynamic-script, real-agent orchestrator
  OpenAI·Vertex·Bedrock·Claude-Managed       │   ◆ RAW Claude dynamic workflows
  (closed, vendor-locked, scalable)          │     most capable — but closed, in-session,
                                      ▼            single-vendor, session-only resume
                         CLOSED / vendor-locked / hosted
```

**RAW Claude dynamic workflows — good / bad.** Good: the most capable script-driven dynamic orchestrator; the unit is a *full Claude Code agent* (real tools); deep IDE/session integration; battle-tested; ultracode auto-orchestration. Bad: **closed**; runs **only inside Claude Code**; **single-vendor** (Claude only); resume is **same-session-only**; not embeddable in your app/CI; you can't inspect/fork/test it offline.

**Ours — good / bad.** Good: **open (MIT)**, **portable** (any Node app/CI), **the only one whose real-agent unit is pluggable & multi-vendor** (claude / codex / cursor / ccz / cloud), **1:1 behavioral fidelity verified** vs raw (34/34), **deterministic offline testing** (MockBackend), transparent journal/resume (a cross-session **superset** of raw). Bad: new/no community, no UI/observability/Python, models the agent as a pluggable unit rather than *being* Claude Code, `vm` sandbox is Node-only.

**The one-liner.** RAW is the **best but closed conductor wired only to Claude**. Managed platforms are **scalable but vendor-locked runtimes that need a conductor**. Open frameworks are **mature but their players are LLM calls, not real agents**. **Ours is the open, vendor-neutral conductor that reproduces raw's dynamic-workflow capability 1:1 and can dispatch to any of them — local CLIs or cloud platforms — as backends.** That cell (open × dynamic-script × pluggable-real-agent × verified) is empty without us.

## 7. vs hosted multi-agent products: Kimi K2.6 Agent Swarm & Manus Wide Research

open-dynamic-workflow is an open, embeddable orchestration **library**. Kimi K2.6 Agent Swarm and Manus Wide Research are hosted **products** solving an adjacent problem — they auto-orchestrate large agent fleets for end-users via a managed cloud platform. These are not direct competitors; they operate in a different layer.

| aspect | Kimi K2.6 Agent Swarm | Manus Wide Research | open-dynamic-workflow (ours) |
|---|---|---|---|
| **Type** | Hosted product (closed swarm orchestration) | Hosted product (closed cloud VM fleet) | Open library — embeddable npm package |
| **Max concurrent agents (vendor claim)** | "300 sub-agents … simultaneously" (up from 100 in K2.5) — Moonshot AI own claim, not independently reproduced | 20 simultaneous subtasks (documented concurrent limit); "tested up to 250 items, theoretically unlimited" (docs claim) | `min(16,cores-2)` local default; `HttpAgentBackend` has no built-in hard cap for cloud runners |
| **Agent unit** | K2.6 model instances (proprietary swarm, definition of "sub-agent" not publicly documented) | "fully capable, general-purpose Manus instance" on a dedicated cloud VM; sub-agents do not talk to each other | Pluggable: `.claude()` / `.codex()` / `.opencode()` / `.worker('ccz')` / `.custom()` / `HttpAgentBackend` (multi-vendor) |
| **Model weights open?** | Yes — `moonshotai/Kimi-K2.6` on HuggingFace (Modified MIT); swarm orchestration layer is proprietary | No | MIT open; all engine source in this repo |
| **Swarm/orchestration open?** | No — proprietary hosted layer ("Kimi Code CLI" / kimi.com) | No — closed cloud platform | Yes — MIT TypeScript, forkable |
| **Resume / journal / checkpoint** | Not documented | Not documented | Cross-session journal-based resume with prefix-chained keys |
| **Multi-vendor agents?** | No — single-vendor (K2.6); "Claw Groups" (multi-model/human) is an explicit research preview | No — single-vendor (Manus instances) | Yes — any CLI or HTTP backend |
| **Offline/deterministic testing** | Not available (hosted only) | Not available (hosted only) | `MockBackend` — fully deterministic, no API calls needed |
| **Pricing** | Hosted via kimi.com (pricing not documented in verified sources) | $20–$40+/mo credit-based (own claim) | Free (MIT) |
| **Fidelity gate vs real engine** | n/a | n/a | 34/34 differential gate vs real Claude Code traces |

### Positioning

Kimi's 300 sub-agents and Manus's hosted scale both exceed our local 16-concurrent default. Both are mature hosted products with polished UX and large-scale infrastructure we cannot match. This project is still early. Frame them honestly: **Kimi and Manus are hosted AI products that auto-orchestrate for end-users behind a managed platform**. We are **the open, vendor-neutral conductor you embed and script** — in your Node app, your CI, your on-prem environment. Our differentiation is: open/embeddable (MIT npm library), multi-vendor pluggable agent unit (any CLI or HTTP backend), deterministic offline testing, cross-session journal resume, and the unit can literally be Claude Code itself. We make no claim to match hosted scale out of the box; the `HttpAgentBackend` can route to any cloud runner for vertical scale.

### Sources (verified)

- Kimi K2.6 Agent Swarm: official Moonshot AI blog <https://www.kimi.com/blog/kimi-k2-6> (accessed 2026-05-29). Verbatim official claim: "300 sub-agents executing across 4,000 coordinated steps simultaneously." Model weights: `moonshotai/Kimi-K2.6` on HuggingFace (Modified MIT). All numbers are Moonshot's own claims; no independent reproduction.
- Manus Wide Research: official Manus blog <https://manus.im/blog/introducing-wide-research> (launched 2025-07-31); official help center <https://help.manus.im/en/articles/11960169-what-is-wide-research> (accessed 2026-05-29). Verbatim help-center spec: "Wide Research can run 20 subtasks simultaneously, equivalent to having 20 Agents helping with one task" and each sub-task is "capped at 50 credits." Note: the widely-cited "100 agents" / "hundreds" figure is from a single launch demo (comparing 100 sneakers), not the documented concurrent limit (20). Docs also say "tested up to 250 items, theoretically unlimited." All numbers are Manus's own claims. *(Secondary/press footnote: Meta agreed to acquire Manus Dec 2025; China's NDRC ordered the deal unwound Apr 2026; product still operating, ownership unresolved — secondary press, ownership unresolved.)*

---

*Note: the mainstream-framework star counts in this document were point-in-time on 2026-05-28 and will drift.*

## Sources
Official Claude: workflows, sub-agents, agent-teams, worktrees, cli-reference, managed-agents (multi-agent + overview), changelog — under `code.claude.com/docs` / `platform.claude.com/docs`; announcement <https://claude.com/blog/introducing-dynamic-workflows-in-claude-code>. Vendor platforms: OpenAI (Responses, Codex CLI), Google Vertex Agent Engine, AWS Bedrock/AgentCore/Strands — URLs in §5. Competitor repos linked inline. Full agent transcripts + DR report under `research/`.
