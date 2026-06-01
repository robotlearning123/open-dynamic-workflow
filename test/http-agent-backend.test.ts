import { describe, it, expect } from "vitest";
import { HttpAgentBackend } from "../src/http-agent-backend.js";
import type { AgentRequest } from "../src/types.js";

const req = (o: Partial<AgentRequest> = {}): AgentRequest => ({ agentId: "a1", prompt: "hello", ...o });

/** Build a fake `fetch` that records the request body and returns `responder(body)` as JSON. */
function fakeFetch(responder: (body: any) => unknown, opts: { ok?: boolean; status?: number; errorBody?: string } = {}) {
  return (async (_url: string, init: { body: string }) => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: "OK",
    text: async () => opts.errorBody ?? "",
    json: async () => responder(JSON.parse(init.body)),
  })) as unknown as typeof fetch;
}

describe("HttpAgentBackend (cloud agent dispatch)", () => {
  it("POSTs the request and returns response.output + usage", async () => {
    let seen: any;
    const be = new HttpAgentBackend({
      url: "https://runner.example/agent",
      fetchImpl: fakeFetch((body) => {
        seen = body;
        return { output: "remote-result", usage: { input_tokens: 11, output_tokens: 7 } };
      }),
    });
    const res = await be.run(req({ prompt: "do it", model: "sonnet" }));
    expect(res.output).toBe("remote-result");
    expect(res.inputTokens).toBe(11);
    expect(res.outputTokens).toBe(7);
    expect(seen.prompt).toBe("do it");
    expect(seen.model).toBe("sonnet");
  });

  it("estimates tokens when usage absent and returns structured output", async () => {
    const be = new HttpAgentBackend({ url: "https://x", fetchImpl: fakeFetch(() => ({ output: { id: 1 } })) });
    const res = await be.run(req({ schema: { type: "object" } }));
    expect(res.output).toEqual({ id: 1 });
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it("throws on a non-ok response", async () => {
    const be = new HttpAgentBackend({ url: "https://x", fetchImpl: fakeFetch(() => ({}), { ok: false, status: 500 }) });
    await expect(be.run(req())).rejects.toThrow(/500/);
  });

  it("aborts a stalled fetch when timeoutMs elapses", async () => {
    // A fetch that never resolves — respects AbortSignal by rejecting when aborted.
    const stalledFetch = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal) {
          init.signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }
      })) as unknown as typeof fetch;

    const be = new HttpAgentBackend({ url: "https://x", fetchImpl: stalledFetch, timeoutMs: 20 });
    await expect(be.run(req())).rejects.toThrow(/abort|AbortError/i);
  });
});
