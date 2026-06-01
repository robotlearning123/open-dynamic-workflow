import { describe, it, expect } from "vitest";
import { MockBackend, AnthropicBackend } from "../src/backend.js";
import type { AgentRequest, JsonSchema } from "../src/types.js";

type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown };

function makeReq(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    agentId: "agent-test-1",
    prompt: "Describe the following in detail: something interesting",
    ...overrides,
  };
}

// ---------- MockBackend ----------

describe("MockBackend — text mode", () => {
  it("returns a string when no schema given", async () => {
    const backend = new MockBackend();
    const res = await backend.run(makeReq());
    expect(typeof res.output).toBe("string");
  });

  it("canned string is derived from prompt", async () => {
    const backend = new MockBackend();
    const prompt = "Describe the following in detail: something interesting";
    const res = await backend.run(makeReq({ prompt }));
    expect(res.output).toBe("[mock] " + prompt.slice(0, 60));
  });

  it("outputTokens > 0 for text output", async () => {
    const backend = new MockBackend();
    const res = await backend.run(makeReq());
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it("inputTokens > 0 for text input", async () => {
    const backend = new MockBackend();
    const res = await backend.run(makeReq());
    expect(res.inputTokens).toBeGreaterThan(0);
  });

  it("deterministic: identical req yields identical output", async () => {
    const backend = new MockBackend();
    const req = makeReq({ prompt: "hello world" });
    const r1 = await backend.run(req);
    const r2 = await backend.run(req);
    expect(r1.output).toEqual(r2.output);
    expect(r1.outputTokens).toBe(r2.outputTokens);
    expect(r1.inputTokens).toBe(r2.inputTokens);
  });

  it("records calls", async () => {
    const backend = new MockBackend();
    const req = makeReq();
    await backend.run(req);
    await backend.run(req);
    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[0]).toBe(req);
  });
});

describe("MockBackend — schema mode", () => {
  it("returns an object (not string) when schema given", async () => {
    const schema: JsonSchema = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(typeof res.output).toBe("object");
    expect(res.output).not.toBeNull();
  });

  it("synthesized output satisfies required properties", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        active: { type: "boolean" },
      },
      required: ["name", "count", "active"],
    };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    const obj = res.output as Record<string, unknown>;
    expect(typeof obj["name"]).toBe("string");
    expect(typeof obj["count"]).toBe("number");
    expect(typeof obj["active"]).toBe("boolean");
  });

  it("string schema yields 'mock'", async () => {
    const schema: JsonSchema = { type: "string" };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(res.output).toBe("mock");
  });

  it("integer schema yields 0", async () => {
    const schema: JsonSchema = { type: "integer" };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(res.output).toBe(0);
  });

  it("boolean schema yields false", async () => {
    const schema: JsonSchema = { type: "boolean" };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(res.output).toBe(false);
  });

  it("array schema yields []", async () => {
    const schema: JsonSchema = { type: "array" };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(res.output).toEqual([]);
  });

  it("enum schema yields the first enum value", async () => {
    const schema: JsonSchema = { type: "string", enum: ["alpha", "beta", "gamma"] };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(res.output).toBe("alpha");
  });

  it("nested object schema fills required fields recursively", async () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["inner"],
      properties: {
        inner: {
          type: "object",
          required: ["value"],
          properties: {
            value: { type: "string" },
          },
        },
      },
    };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    const obj = res.output as Record<string, unknown>;
    const inner = obj["inner"] as Record<string, unknown>;
    expect(typeof inner["value"]).toBe("string");
  });

  it("outputTokens > 0 for schema output", async () => {
    const schema: JsonSchema = { type: "object", properties: { x: { type: "string" } }, required: ["x"] };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it("deterministic: identical schema req yields identical output", async () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["a", "b"],
      properties: { a: { type: "string" }, b: { type: "integer" } },
    };
    const backend = new MockBackend();
    const req = makeReq({ schema });
    const r1 = await backend.run(req);
    const r2 = await backend.run(req);
    expect(r1.output).toEqual(r2.output);
    expect(r1.outputTokens).toBe(r2.outputTokens);
  });

  it("outputTokens = ceil(JSON.stringify(output).length / 4)", async () => {
    const schema: JsonSchema = { type: "object", properties: { x: { type: "string" } }, required: ["x"] };
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ schema }));
    const expected = Math.ceil(JSON.stringify(res.output).length / 4);
    expect(res.outputTokens).toBe(expected);
  });

  it("inputTokens = ceil(prompt.length / 4)", async () => {
    const prompt = "hello world test prompt";
    const backend = new MockBackend();
    const res = await backend.run(makeReq({ prompt }));
    const expected = Math.ceil(prompt.length / 4);
    expect(res.inputTokens).toBe(expected);
  });
});

describe("MockBackend — custom responder", () => {
  it("uses responder when provided", async () => {
    const backend = new MockBackend({ responder: (_req) => ({ custom: true }) });
    const res = await backend.run(makeReq());
    expect(res.output).toEqual({ custom: true });
  });
});

// ---------- AnthropicBackend — unit tests with fake client (no network) ----------

/** Build a fake Anthropic client that returns a canned tool_use response. */
function makeFakeClient(cannedInput: unknown): { messages: { create: (_params: unknown) => Promise<unknown> } } {
  const fakeMsg = {
    content: [
      {
        type: "tool_use",
        id: "tu_001",
        name: "StructuredOutput",
        input: cannedInput,
      } satisfies ContentBlock,
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
  return {
    messages: {
      create: async (_params: unknown) => fakeMsg,
    },
  };
}

/** Fake client that returns a text block. */
function makeFakeTextClient(text: string): { messages: { create: (...args: unknown[]) => Promise<unknown> } } {
  return {
    messages: {
      create: async (_params: unknown) => ({
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 15 },
      }),
    },
  };
}

describe("AnthropicBackend — schema path (injected client, no network)", () => {
  it("parses tool_use.input as output", async () => {
    const schema: JsonSchema = { type: "object", properties: { x: { type: "string" } }, required: ["x"] };
    const cannedInput = { x: "hello" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: makeFakeClient(cannedInput) as any });
    const res = await backend.run(makeReq({ schema }));
    expect(res.output).toEqual({ x: "hello" });
  });

  it("returns inputTokens and outputTokens from usage", async () => {
    const schema: JsonSchema = { type: "object", properties: { x: { type: "string" } }, required: ["x"] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: makeFakeClient({ x: "hi" }) as any });
    const res = await backend.run(makeReq({ schema }));
    expect(res.inputTokens).toBe(10);
    expect(res.outputTokens).toBe(20);
  });

  it("outputTokens > 0", async () => {
    const schema: JsonSchema = { type: "object", properties: { y: { type: "integer" } }, required: ["y"] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: makeFakeClient({ y: 42 }) as any });
    const res = await backend.run(makeReq({ schema }));
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it("resolves 'sonnet' alias to 'claude-sonnet-4-6'", async () => {
    const schema: JsonSchema = { type: "string" };
    let capturedModel = "";
    const client = {
      messages: {
        create: async (params: { model: string }) => {
          capturedModel = params.model;
          return {
            content: [{ type: "tool_use", id: "x", name: "StructuredOutput", input: "mock" }],
            stop_reason: "tool_use",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: client as any });
    await backend.run(makeReq({ schema, model: "sonnet" }));
    expect(capturedModel).toBe("claude-sonnet-4-6");
  });

  it("resolves 'haiku' alias to 'claude-haiku-4-5-20251001'", async () => {
    const schema: JsonSchema = { type: "string" };
    let capturedModel = "";
    const client = {
      messages: {
        create: async (params: { model: string }) => {
          capturedModel = params.model;
          return {
            content: [{ type: "tool_use", id: "x", name: "StructuredOutput", input: "mock" }],
            stop_reason: "tool_use",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: client as any });
    await backend.run(makeReq({ schema, model: "haiku" }));
    expect(capturedModel).toBe("claude-haiku-4-5-20251001");
  });

  it("resolves 'opus' alias to 'claude-opus-4-6'", async () => {
    const schema: JsonSchema = { type: "string" };
    let capturedModel = "";
    const client = {
      messages: {
        create: async (params: { model: string }) => {
          capturedModel = params.model;
          return {
            content: [{ type: "tool_use", id: "x", name: "StructuredOutput", input: "mock" }],
            stop_reason: "tool_use",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: client as any });
    await backend.run(makeReq({ schema, model: "opus" }));
    expect(capturedModel).toBe("claude-opus-4-6");
  });

  it("retries on validation error and succeeds on second call", async () => {
    const schema: JsonSchema = { type: "object", required: ["id"], properties: { id: { type: "integer" } } };
    let callCount = 0;
    const client = {
      messages: {
        create: async (_params: unknown) => {
          callCount++;
          // First call returns invalid (string for integer field), second call returns valid
          const input = callCount === 1 ? { id: "not-an-integer" } : { id: 42 };
          return {
            content: [{ type: "tool_use", id: "x", name: "StructuredOutput", input }],
            stop_reason: "tool_use",
            usage: { input_tokens: 5, output_tokens: 5 },
          };
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: client as any });
    const res = await backend.run(makeReq({ schema }));
    expect(callCount).toBe(2);
    expect((res.output as Record<string, unknown>)["id"]).toBe(42);
  });
});

describe("AnthropicBackend — text path (injected client, no network)", () => {
  it("joins text blocks into a string", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: makeFakeTextClient("hello from model") as any });
    const res = await backend.run(makeReq());
    expect(res.output).toBe("hello from model");
    expect(typeof res.output).toBe("string");
  });

  it("returns inputTokens and outputTokens from usage", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: makeFakeTextClient("hi") as any });
    const res = await backend.run(makeReq());
    expect(res.inputTokens).toBe(5);
    expect(res.outputTokens).toBe(15);
  });

  it("outputTokens > 0", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = new AnthropicBackend({ client: makeFakeTextClient("some output text") as any });
    const res = await backend.run(makeReq());
    expect(res.outputTokens).toBeGreaterThan(0);
  });
});
