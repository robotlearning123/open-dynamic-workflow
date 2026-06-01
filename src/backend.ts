import Anthropic from "@anthropic-ai/sdk";
import type { AgentBackend, AgentRequest, AgentResponse, JsonSchema } from "./types.js";
import { toToolDef, validate, MAX_SCHEMA_RETRIES } from "./structured-output.js";

/**
 * A tool a subagent may call during its turn — this is the gap-closer vs the real engine,
 * whose subagents are full Claude Code agents with Bash/filesystem/MCP. Register tools on
 * AnthropicBackend and agent() prompts can use them, then return text or structured output.
 */
export interface AgentTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
  handler: (input: unknown) => unknown | Promise<unknown>;
}

// Model aliases — ANALYSIS §8
const DEFAULT_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  opus: "claude-opus-4-6",
};

// ---------- MockBackend ----------

/** Synthesize a minimal valid JSON instance for a schema — deterministic, no Date/random. */
function synthesize(schema: JsonSchema): unknown {
  // enum: first element wins
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return schema.enum[0];
  }

  switch (schema.type) {
    case "string":
      return "mock";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array":
      return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      // fill required properties first; then any properties not in required
      const required = new Set(schema.required ?? []);
      const properties = schema.properties ?? {};
      // required fields
      for (const key of required) {
        const childSchema = properties[key] ?? {};
        obj[key] = synthesize(childSchema);
      }
      // non-required declared properties — still fill so the object is well-formed
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!required.has(key)) {
          obj[key] = synthesize(childSchema);
        }
      }
      return obj;
    }
    default:
      // no type hint or unknown type — return empty object
      return {};
  }
}

export class MockBackend implements AgentBackend {
  readonly calls: AgentRequest[] = [];

  private readonly _responder: ((req: AgentRequest) => unknown) | undefined;
  private readonly _delayMs: number;

  constructor(o?: { responder?: (req: AgentRequest) => unknown; delayMs?: number }) {
    this._responder = o?.responder;
    this._delayMs = o?.delayMs ?? 0;
  }

  async run(req: AgentRequest): Promise<AgentResponse> {
    if (this._delayMs > 0) {
      await new Promise<void>((res) => setTimeout(res, this._delayMs));
    }
    this.calls.push(req);

    let output: unknown;
    if (this._responder !== undefined) {
      output = this._responder(req);
    } else if (req.schema !== undefined) {
      output = synthesize(req.schema);
    } else {
      // canned string derived from the prompt — deterministic
      output = "[mock] " + req.prompt.slice(0, 60);
    }

    const outputTokens = Math.ceil(JSON.stringify(output).length / 4);
    const inputTokens = Math.ceil(req.prompt.length / 4);
    return { output, inputTokens, outputTokens };
  }
}

// ---------- AnthropicBackend ----------

/** Minimal shape of the Anthropic client we use — matches the verified SDK contract in SPEC.md. */
interface MessagesCreate {
  create(params: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: Array<{ role: "user" | "assistant"; content: string | ContentBlock[] }>;
    tools?: ToolDef[];
    tool_choice?: { type: "tool"; name: string };
  }): Promise<AnthropicMessage>;
}

interface AnthropicClient {
  messages: MessagesCreate;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

interface AnthropicMessage {
  content: ContentBlock[];
  stop_reason?: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicBackend implements AgentBackend {
  private readonly _client: AnthropicClient;
  private readonly _defaultModel: string;
  private readonly _maxTokens: number;
  private readonly _aliases: Record<string, string>;
  private readonly _tools: AgentTool[];
  private readonly _maxToolTurns: number;

  constructor(o?: {
    apiKey?: string;
    /** Custom base URL forwarded to the Anthropic client (e.g. an OpenRouter proxy). */
    baseURL?: string;
    /** Name of the env var that holds the API key (default: ANTHROPIC_API_KEY). */
    apiKeyEnv?: string;
    defaultModel?: string;
    maxTokens?: number;
    client?: AnthropicClient;
    aliases?: Record<string, string>;
    /** Tools subagents may call before answering (gap-closer vs the real engine). */
    tools?: AgentTool[];
    /** Max tool-use round-trips per agent before forcing an answer. Default 8. */
    maxToolTurns?: number;
  }) {
    if (o?.client !== undefined) {
      this._client = o.client;
    } else {
      const apiKey = o?.apiKey ?? process.env[o?.apiKeyEnv ?? "ANTHROPIC_API_KEY"];
      // Cast: the real Anthropic SDK type is more specific than our narrow AnthropicClient
      // interface; it is a structural subset, so this cast is safe at runtime.
      this._client = new Anthropic({
        apiKey,
        ...(o?.baseURL !== undefined ? { baseURL: o.baseURL } : {}),
      }) as unknown as AnthropicClient;
    }
    this._defaultModel = o?.defaultModel ?? "claude-sonnet-4-6";
    this._maxTokens = o?.maxTokens ?? 4096;
    this._aliases = { ...DEFAULT_ALIASES, ...o?.aliases };
    this._tools = o?.tools ?? [];
    this._maxToolTurns = o?.maxToolTurns ?? 8;
  }

  private resolveModel(model: string | undefined): string {
    const m = model ?? this._defaultModel;
    return this._aliases[m] ?? m;
  }

  async run(req: AgentRequest): Promise<AgentResponse> {
    const model = this.resolveModel(req.model);

    // When tools are registered, subagents may call them before answering (the gap-closer
    // vs the real engine). Default (no tools) keeps the original text/structured paths exactly.
    if (this._tools.length > 0) {
      return this._runWithTools(req, model);
    }
    if (req.schema !== undefined) {
      return this._runStructured(req, model);
    }
    return this._runText(req, model);
  }

  private async _runText(req: AgentRequest, model: string): Promise<AgentResponse> {
    const msg = await this._client.messages.create({
      model,
      max_tokens: this._maxTokens,
      messages: [{ role: "user", content: req.prompt }],
    });

    const text = msg.content
      .filter((b): b is ContentBlock & { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");

    return {
      output: text,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    };
  }

  private async _runStructured(req: AgentRequest, model: string): Promise<AgentResponse> {
    const toolDef = toToolDef(req.schema!);
    // Build initial messages list
    type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };
    const messages: Message[] = [{ role: "user", content: req.prompt }];

    let attempt = 0;
    let inTok = 0;
    let outTok = 0;

    while (attempt <= MAX_SCHEMA_RETRIES) {
      const msg = await this._client.messages.create({
        model,
        max_tokens: this._maxTokens,
        messages,
        tools: [toolDef],
        tool_choice: { type: "tool", name: "StructuredOutput" },
      });
      inTok += msg.usage.input_tokens;
      outTok += msg.usage.output_tokens;

      // Find the tool_use block
      const toolUse = msg.content.find(
        (b): b is ContentBlock & { type: "tool_use"; input: unknown } =>
          b.type === "tool_use" && b.name === "StructuredOutput",
      );

      if (toolUse !== undefined) {
        const result = validate(toolUse.input, req.schema!);
        if (result.ok) {
          return {
            output: toolUse.input,
            inputTokens: inTok,
            outputTokens: outTok,
          };
        }

        if (attempt < MAX_SCHEMA_RETRIES) {
          // The API requires a tool_result for the StructuredOutput tool_use, so feed the validation
          // errors back AS that tool_result — a bare user text message would be rejected (400).
          const errorMsg = "Validation errors: " + result.errors.join("; ") + ". Please fix and call StructuredOutput again.";
          messages.push({ role: "assistant", content: msg.content });
          messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id!, content: errorMsg }] });
        }
      }

      attempt++;
    }

    // Exhausted retries without a schema-valid result. Throw rather than return invalid/empty
    // output — agent({schema}) is contractually "matches the schema"; a thrown error lets
    // parallel()/pipeline() map it to null per the documented semantics.
    throw new Error(`StructuredOutput failed schema validation after ${MAX_SCHEMA_RETRIES + 1} attempt(s)`);
  }

  // ---------- tool-use path (gap-closer) ----------

  private async _executeTools(
    uses: Array<ContentBlock & { id: string; name: string; input: unknown }>,
  ): Promise<ContentBlock[]> {
    const results: ContentBlock[] = [];
    for (const u of uses) {
      const tool = this._tools.find((t) => t.name === u.name);
      let content: string;
      try {
        const out = tool ? await tool.handler(u.input) : `unknown tool: ${u.name}`;
        // JSON.stringify(undefined) is undefined → the content key would be omitted (API requires it).
        content = typeof out === "string" ? out : JSON.stringify(out ?? null);
      } catch (e) {
        content = "tool error: " + (e instanceof Error ? e.message : String(e));
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content });
    }
    return results;
  }

  private async _runWithTools(req: AgentRequest, model: string): Promise<AgentResponse> {
    type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };
    const messages: Message[] = [{ role: "user", content: req.prompt }];
    const toolDefs: ToolDef[] = this._tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
    if (req.schema !== undefined) toolDefs.push(toToolDef(req.schema));

    let inTok = 0;
    let outTok = 0;

    for (let turn = 0; turn < this._maxToolTurns; turn++) {
      const msg = await this._client.messages.create({
        model,
        max_tokens: this._maxTokens,
        messages,
        tools: toolDefs,
      });
      inTok += msg.usage.input_tokens;
      outTok += msg.usage.output_tokens;

      const toolUses = msg.content.filter(
        (b): b is ContentBlock & { id: string; name: string; input: unknown } =>
          b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string",
      );
      const structured = toolUses.find((b) => b.name === "StructuredOutput");

      if (structured !== undefined) {
        const v = validate(structured.input, req.schema as JsonSchema);
        if (v.ok) return { output: structured.input, inputTokens: inTok, outputTokens: outTok };
        // The API requires a tool_result for EVERY tool_use in the assistant message — so respond to
        // the StructuredOutput call with the validation error AND execute any sibling user-tool calls
        // (otherwise the next request 400s on the missing tool_results).
        const errText = "Validation errors: " + v.errors.join("; ") + ". Call StructuredOutput again with a corrected argument.";
        const results: ContentBlock[] = [{ type: "tool_result", tool_use_id: structured.id, content: errText }];
        const siblings = toolUses.filter((b) => b.name !== "StructuredOutput");
        if (siblings.length > 0) results.push(...(await this._executeTools(siblings)));
        messages.push({ role: "assistant", content: msg.content });
        messages.push({ role: "user", content: results });
        continue;
      }

      const userUses = toolUses.filter((b) => b.name !== "StructuredOutput");
      if (msg.stop_reason === "tool_use" && userUses.length > 0) {
        messages.push({ role: "assistant", content: msg.content });
        messages.push({ role: "user", content: await this._executeTools(userUses) });
        continue;
      }

      if (req.schema !== undefined) {
        // Model paused without structured output — nudge it to finalize.
        messages.push({ role: "assistant", content: msg.content });
        messages.push({ role: "user", content: "Now call the StructuredOutput tool with your final answer." });
        continue;
      }

      // Plain-text final answer.
      const text = msg.content
        .filter((b): b is ContentBlock & { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      return { output: text, inputTokens: inTok, outputTokens: outTok };
    }

    // Ran out of tool turns without a final answer — fail rather than return {} / "" (which would
    // violate the schema contract / hand back empty output). parallel()/pipeline() map this to null.
    throw new Error(`agent did not finish within maxToolTurns (${this._maxToolTurns})`);
  }
}
