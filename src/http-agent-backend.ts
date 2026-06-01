import type { AgentBackend, AgentRequest, AgentResponse } from "./types.js";
import { estTokens } from "./utils.js";

// HttpAgentBackend — the "local → cloud" axis. Dispatch each agent() call to a REMOTE agent
// runner over HTTP (a cloud worker, a queue gateway, a hosted agent service). Same orchestration
// (parallel/pipeline/journal/resume) runs locally; only the basic unit — the agent — moves to the
// cloud. `fetchImpl` is injectable so the whole path is unit-testable with no network.

export interface HttpAgentSpec {
  /** Endpoint that runs one agent and returns its result. */
  url: string;
  headers?: Record<string, string>;
  /** Request body builder. Default: { prompt, schema, model, agentId, agentType }. */
  buildBody?: (req: AgentRequest) => unknown;
  /** Extract the agent output (and optionally token usage) from the JSON response.
   *  Default: response.output (or the whole body), usage from response.usage if present. */
  parseResponse?: (json: unknown, req: AgentRequest) => { output: unknown; inputTokens?: number; outputTokens?: number };
  /** Injected fetch (defaults to global fetch) — pass a fake in tests. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms. Default 300000. */
  timeoutMs?: number;
}

function defaultParse(json: unknown, _req: AgentRequest): { output: unknown; inputTokens?: number; outputTokens?: number } {
  if (json !== null && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const usage = (o["usage"] ?? {}) as Record<string, unknown>;
    return {
      output: "output" in o ? o["output"] : json,
      ...(typeof usage["input_tokens"] === "number" ? { inputTokens: usage["input_tokens"] as number } : {}),
      ...(typeof usage["output_tokens"] === "number" ? { outputTokens: usage["output_tokens"] as number } : {}),
    };
  }
  return { output: json };
}

export class HttpAgentBackend implements AgentBackend {
  constructor(private readonly spec: HttpAgentSpec) {}

  async run(req: AgentRequest): Promise<AgentResponse> {
    const fetchImpl = this.spec.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("HttpAgentBackend: no fetch available — pass spec.fetchImpl");
    }
    const body =
      this.spec.buildBody !== undefined
        ? this.spec.buildBody(req)
        : { prompt: req.prompt, schema: req.schema, model: req.model, agentId: req.agentId, agentType: req.agentType };

    const controller = new AbortController();
    const timeoutMs = this.spec.timeoutMs ?? 300_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(this.spec.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.spec.headers ?? {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HttpAgentBackend: ${this.spec.url} returned ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error(`HttpAgentBackend: ${this.spec.url} returned a non-JSON body (${e instanceof Error ? e.message : String(e)})`);
    }
    const parsed = (this.spec.parseResponse ?? defaultParse)(json, req);
    return {
      output: parsed.output,
      // estTokens is an ESTIMATE (chars/4), not billed tokens — used only when the server omits usage.
      inputTokens: parsed.inputTokens ?? estTokens(req.prompt),
      outputTokens: parsed.outputTokens ?? estTokens(JSON.stringify(parsed.output ?? "")),
    };
  }
}
