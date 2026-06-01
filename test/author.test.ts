import { describe, it, expect } from "vitest";
import { authorWorkflow, extractScript, buildAuthorPrompt } from "../src/author.js";
import { MockBackend } from "../src/backend.js";
import type { AgentBackend } from "../src/types.js";

/** A stand-in for ANY author agent: returns a fixed script (proves the layer is backend-agnostic —
 *  swap this for CliAgentBackend.claude()/.worker('ccz') / HttpAgentBackend to author with a real agent). */
const scriptAuthor = (script: string): AgentBackend => ({
  async run() {
    return { output: script, inputTokens: 0, outputTokens: 1 };
  },
});

const GOOD = [
  "export const meta = { name: 'gen', description: 'generated' };",
  "const r = await parallel([() => agent('a'), () => agent('b')]);",
  "return { n: r.length };",
].join("\n");

describe("authorWorkflow — any agent authors, not bound to Claude", () => {
  it("authors via the author backend, then executes on the run backend", async () => {
    const { script, run } = await authorWorkflow("do two things in parallel", {
      authorBackend: scriptAuthor(GOOD),
      runBackend: new MockBackend(),
    });
    expect(script).toContain("export const meta");
    expect(run?.result).toEqual({ n: 2 });
    expect(run?.agentCount).toBe(2);
  });

  it("defaults runBackend to authorBackend when omitted (same agent authors AND executes)", async () => {
    const dual = scriptAuthor(GOOD);
    const { run } = await authorWorkflow("x", { authorBackend: dual });
    expect(run?.result).toEqual({ n: 2 });
  });

  it("dryRun returns the authored script without executing it", async () => {
    const { script, run } = await authorWorkflow("x", { authorBackend: scriptAuthor(GOOD), dryRun: true });
    expect(run).toBeUndefined();
    expect(script).toContain("export const meta");
  });

  it("strips markdown fences and leading prose from the author output", () => {
    const raw = "sure, here:\n```js\nexport const meta = { name: 'a', description: 'b' };\nreturn 1;\n```\nhope it helps";
    expect(extractScript(raw)).toBe("export const meta = { name: 'a', description: 'b' };\nreturn 1;");
  });

  it("fails loud when the author did not produce a valid workflow", async () => {
    await expect(
      authorWorkflow("x", { authorBackend: scriptAuthor("I cannot help with that."), runBackend: new MockBackend() }),
    ).rejects.toThrow(/valid workflow/i);
  });

  it("buildAuthorPrompt embeds the task and teaches the primitives", () => {
    const p = buildAuthorPrompt("audit endpoints for missing auth");
    expect(p).toContain("audit endpoints for missing auth");
    expect(p).toContain("export const meta");
    expect(p).toContain("parallel");
  });
});
