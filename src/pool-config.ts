/**
 * pool-config.ts — declarative pool builder (definePool).
 *
 * Maps a PoolMemberSpec (agent × model) to a concrete AgentBackend, then
 * assembles them into a PoolBackend.
 *
 * Design: secret-free — members reference envKey/envKeys/apiKeyEnv only.
 * No hardcoded credentials, base URLs beyond what the operator supplies.
 */

import type { AgentBackend, AgentRequest } from "./types.js";
import { MockBackend, AnthropicBackend } from "./backend.js";
import { CliAgentBackend } from "./cli-agent-backend.js";
import { HttpAgentBackend } from "./http-agent-backend.js";
import { PoolState } from "./pool-state.js";
import type { StateStore, MemberLimits } from "./pool-state.js";
import { memoryStore } from "./pool-state.js";
import { PoolBackend } from "./pool-backend.js";
import type { PoolRoute } from "./pool-backend.js";

// ---------- PoolMemberSpec ----------

/**
 * Declarative specification for a single pool member (agent × model cell).
 *
 * `agent` selects the harness (execution engine); `model` selects the LLM.
 * The same model can appear under different agents; you declare only the cells you use.
 */
export interface PoolMemberSpec {
  /** Unique routing name — used in workflow scripts as `{ model: "<name>" }`. */
  name: string;
  /**
   * Label(s) that match incoming `req.model` / `req.agentType`.
   * A string or an array of strings (logical OR).
   */
  match: string | string[];

  /**
   * The harness (execution engine) for this member.
   *
   * | value          | backend                             |
   * |----------------|-------------------------------------|
   * | anthropic       | AnthropicBackend (bare API)         |
   * | http            | HttpAgentBackend (OpenAI-compat)    |
   * | cc / claude     | CliAgentBackend.claude()            |
   * | codex / cx      | CliAgentBackend.codex()             |
   * | opencode        | CliAgentBackend.opencode()          |
   * | ccz / ccd / ccq | CliAgentBackend.worker(bin)         |
   * | mock            | MockBackend                         |
   */
  agent:
    | "anthropic"
    | "http"
    | "cc"
    | "claude"
    | "codex"
    | "cx"
    | "opencode"
    | "ccz"
    | "ccd"
    | "ccq"
    | "mock";

  /** LLM model id to use (passed to the backend as defaultModel / --model). */
  model?: string;

  // ---- anthropic / http options ----

  /** Custom base URL for AnthropicBackend (e.g. an OpenRouter proxy). */
  baseURL?: string;
  /** For `http` agent: the OpenAI-compatible chat completions endpoint URL. Required. */
  url?: string;
  /**
   * For `anthropic` agent: name of the env var holding the API key.
   * Defaults to ANTHROPIC_API_KEY.
   */
  apiKeyEnv?: string;
  /**
   * For `http` agent: name of the single env var holding the Bearer token.
   * Used for Authorization: Bearer $ENV_VAR.
   */
  envKey?: string;
  /**
   * For `http` agent: list of env var names to round-robin across requests.
   * Each call uses the next key in the list (counter-based, not random).
   * Takes precedence over `envKey` when present.
   */
  envKeys?: string[];
  /** For `http` agent: injected fetch implementation (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;

  // ---- scheduling / budget ----

  /** Routing priority — higher is preferred. Default 0. */
  priority?: number;
  /** Max requests per minute. */
  rpm?: number;
  /** Max requests per day. */
  rpd?: number;
  /** Max concurrent requests. */
  concurrency?: number;
  /**
   * Fallback member names to try (in order) when this member is rate-limited or failing.
   */
  fallback?: string[];
}

// ---------- definePoolOptions ----------

export interface DefinePoolOptions {
  /** Name of the default member to use when no label matches. */
  default: string;
  /** Pool members — each is one (agent × model) cell. */
  members: PoolMemberSpec[];
  /** State store — defaults to memoryStore(). */
  state?: StateStore;
  /** Logger called on routing events (shed, fallback, cooldown). */
  log?: (m: string) => void;
}

// ---------- helper: HttpAgentBackend with round-robin keys ----------

/**
 * Builds an HttpAgentBackend for an OpenAI-compatible endpoint.
 *
 * When `envKeys` is supplied, rotates through them on successive calls
 * (counter-based, deterministic, never random). When only `envKey` is
 * supplied, uses that single key for every call.
 */
function buildHttpBackend(spec: PoolMemberSpec): AgentBackend {
  if (spec.url === undefined || spec.url === "") {
    throw new Error(`pool-config: member "${spec.name}" (agent: http) requires a url`);
  }
  const url = spec.url;
  const model = spec.model;
  const baseFetch: typeof fetch = spec.fetchImpl ?? fetch;

  // Determine the key-rotation strategy at construction time.
  // counter lives in the closure so it persists across calls without a class.
  let counter = 0;
  const envKeys = spec.envKeys;
  const envKey = spec.envKey;

  function getAuthHeader(): string {
    if (envKeys !== undefined && envKeys.length > 0) {
      const idx = counter % envKeys.length;
      counter++;
      const key = process.env[envKeys[idx] ?? ""];
      return key !== undefined ? `Bearer ${key}` : "";
    }
    if (envKey !== undefined) {
      const key = process.env[envKey];
      return key !== undefined ? `Bearer ${key}` : "";
    }
    return "";
  }

  return new HttpAgentBackend({
    url,
    buildBody: (req: AgentRequest) => ({
      model: req.model ?? model,
      messages: [{ role: "user", content: req.prompt }],
      max_tokens: 4096,
    }),
    parseResponse: (json: unknown, _req: AgentRequest) => {
      if (json !== null && typeof json === "object") {
        const o = json as Record<string, unknown>;
        const choices = o["choices"];
        if (Array.isArray(choices) && choices.length > 0) {
          const first = choices[0] as Record<string, unknown>;
          const message = first["message"] as Record<string, unknown> | undefined;
          const content = message?.["content"];
          const usage = o["usage"] as Record<string, unknown> | undefined;
          return {
            output: typeof content === "string" ? content : JSON.stringify(content ?? ""),
            ...(typeof usage?.["prompt_tokens"] === "number" ? { inputTokens: usage["prompt_tokens"] as number } : {}),
            ...(typeof usage?.["completion_tokens"] === "number" ? { outputTokens: usage["completion_tokens"] as number } : {}),
          };
        }
      }
      return { output: json };
    },
    // Inject a per-request Authorization header via a custom fetchImpl wrapper
    // so we can rotate keys without modifying HttpAgentBackend.
    fetchImpl: async (input, init) => {
      const auth = getAuthHeader();
      const headers = new Headers(init?.headers);
      if (auth !== "") headers.set("Authorization", auth);
      return baseFetch(input, { ...init, headers });
    },
  });
}

// ---------- buildBackend ----------

function buildBackend(spec: PoolMemberSpec): AgentBackend {
  switch (spec.agent) {
    case "anthropic":
      return new AnthropicBackend({
        ...(spec.model !== undefined ? { defaultModel: spec.model } : {}),
        ...(spec.baseURL !== undefined ? { baseURL: spec.baseURL } : {}),
        ...(spec.apiKeyEnv !== undefined ? { apiKeyEnv: spec.apiKeyEnv } : {}),
      });

    case "http":
      return buildHttpBackend(spec);

    case "cc":
    case "claude":
      return CliAgentBackend.claude({
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });

    case "codex":
    case "cx":
      return CliAgentBackend.codex({
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });

    case "opencode":
      return CliAgentBackend.opencode({
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });

    case "ccz":
      return CliAgentBackend.worker("ccz", {
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });

    case "ccd":
      return CliAgentBackend.worker("ccd", {
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });

    case "ccq":
      return CliAgentBackend.worker("ccq", {
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });

    case "mock":
      return new MockBackend();
  }
}

// ---------- definePool ----------

/**
 * Build a PoolBackend from a declarative pool specification.
 *
 * Each member's `agent` field selects the harness; `model` selects the LLM.
 * The returned PoolBackend implements AgentBackend and can be used directly as
 * `RunConfig.backend`.
 *
 * @example
 * ```ts
 * const pool = definePool({
 *   default: "worker",
 *   state: fileStore(".runs/pool-state.json"),
 *   members: [
 *     { name: "orchestrator", match: ["orchestrator", "author"],
 *       agent: "cc", model: "claude-opus-4-8", apiKeyEnv: "ANTHROPIC_API_KEY", priority: 100 },
 *     { name: "worker", match: ["worker", "glm"],
 *       agent: "http", url: "https://openrouter.ai/api/v1/chat/completions",
 *       model: "z-ai/glm-4.5-air:free", envKey: "OPENROUTER_API_KEY",
 *       rpm: 20, rpd: 1000, concurrency: 4, priority: 50 },
 *     { name: "mock", match: "mock", agent: "mock" },
 *   ],
 * });
 * ```
 */
export function definePool(opts: DefinePoolOptions): PoolBackend {
  const memberNames = opts.members.map((m) => m.name);

  // Build limits map from member specs.
  const limits: Record<string, MemberLimits> = {};
  for (const spec of opts.members) {
    limits[spec.name] = {
      ...(spec.rpm !== undefined ? { rpm: spec.rpm } : {}),
      ...(spec.rpd !== undefined ? { rpd: spec.rpd } : {}),
      ...(spec.concurrency !== undefined ? { concurrency: spec.concurrency } : {}),
      ...(spec.priority !== undefined ? { priority: spec.priority } : {}),
    };
  }

  const state = new PoolState(memberNames, limits);

  // Warm-start from the store if available. The load is async; we expose it as
  // `pool.ready` so callers who need accurate daily-budget (rpd)/cooldown state
  // can `await pool.ready` before the first dispatch.
  const store = opts.state ?? memoryStore();
  const ready = store.load().then((snap) => {
    if (snap !== null) state.loadSnapshot(snap);
  }).catch(() => {
    // Startup load failure is non-fatal — we start fresh.
  });

  // Build PoolRoute array.
  const routes: PoolRoute[] = opts.members.map((spec) => ({
    name: spec.name,
    match: spec.match,
    backend: buildBackend(spec),
    ...(spec.priority !== undefined ? { priority: spec.priority } : {}),
    ...(spec.rpm !== undefined ? { rpm: spec.rpm } : {}),
    ...(spec.rpd !== undefined ? { rpd: spec.rpd } : {}),
    ...(spec.concurrency !== undefined ? { concurrency: spec.concurrency } : {}),
    ...(spec.fallback !== undefined ? { fallback: spec.fallback } : {}),
  }));

  return new PoolBackend({
    routes,
    default: opts.default,
    state,
    store,
    ready,
    ...(opts.log !== undefined ? { log: opts.log } : {}),
  });
}
