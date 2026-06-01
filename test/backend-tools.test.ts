import { describe, it, expect } from "vitest";
import { AnthropicBackend } from "../src/backend.js";
import type { AgentRequest } from "../src/types.js";

const req = (o: Partial<AgentRequest> = {}): AgentRequest => ({ agentId: "a1", prompt: "use the adder for 2+3", ...o });

describe("AnthropicBackend tool-use loop (gap-closer)", () => {
  it("executes a registered tool then returns final text, accumulating tokens", async () => {
    let turn = 0;
    const fakeClient = {
      messages: {
        create: async () => {
          turn++;
          if (turn === 1) {
            return {
              content: [{ type: "tool_use", id: "tu1", name: "adder", input: { a: 2, b: 3 } }],
              stop_reason: "tool_use",
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          }
          return { content: [{ type: "text", text: "sum=5" }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 6 } };
        },
      },
    };
    const calls: unknown[] = [];
    const be = new AnthropicBackend({
      client: fakeClient as never,
      tools: [
        {
          name: "adder",
          description: "add two integers",
          input_schema: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } } },
          handler: (i: any) => {
            calls.push(i);
            return String(i.a + i.b);
          },
        },
      ],
    });
    const res = await be.run(req());
    expect(res.output).toBe("sum=5");
    expect(calls).toEqual([{ a: 2, b: 3 }]);
    expect(res.outputTokens).toBe(11); // 5 + 6 accumulated across tool turns
  });

  it("throws on schema-retry exhaustion instead of returning invalid output [M2]", async () => {
    // client always returns a StructuredOutput that violates the schema
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [{ type: "tool_use", id: "t", name: "StructuredOutput", input: { wrong: 1 } }],
          stop_reason: "tool_use",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };
    const be = new AnthropicBackend({ client: fakeClient as never });
    await expect(
      be.run({ agentId: "a1", prompt: "x", schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } }),
    ).rejects.toThrow(/schema validation/);
  });

  it("with schema + tools: uses a tool, then emits StructuredOutput", async () => {
    let turn = 0;
    const fakeClient = {
      messages: {
        create: async () => {
          turn++;
          if (turn === 1) {
            return {
              content: [{ type: "tool_use", id: "t1", name: "lookup", input: { q: "x" } }],
              stop_reason: "tool_use",
              usage: { input_tokens: 5, output_tokens: 5 },
            };
          }
          return {
            content: [{ type: "tool_use", id: "t2", name: "StructuredOutput", input: { id: 7 } }],
            stop_reason: "tool_use",
            usage: { input_tokens: 5, output_tokens: 5 },
          };
        },
      },
    };
    const be = new AnthropicBackend({
      client: fakeClient as never,
      tools: [{ name: "lookup", description: "look up", input_schema: { type: "object" }, handler: () => "found" }],
    });
    const res = await be.run(req({ schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } }));
    expect(res.output).toEqual({ id: 7 });
  });
});
