import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkflow } from "../src/runner.js";
import { MockBackend } from "../src/backend.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "odw-nested-"));

describe("nested workflow() runs in the same vm sandbox (determinism, not host realm)", () => {
  it("blocks Date.now() and Math.random() inside a CHILD workflow", async () => {
    // The child probes the sandbox. Before the fix it ran via host-realm `new Function`, so these
    // would NOT be blocked; now it shares runInSandbox, so they throw like the top-level script.
    const child = [
      "export const meta = { name: 'child', description: 'probe sandbox' };",
      "let dateBlocked = false; try { Date.now(); } catch { dateBlocked = true; }",
      "let randBlocked = false; try { Math.random(); } catch { randBlocked = true; }",
      "return { dateBlocked, randBlocked };",
    ].join("\n");
    const parent = [
      "export const meta = { name: 'parent', description: 'calls child' };",
      "return await workflow({ scriptPath: 'child' });",
    ].join("\n");

    const res = await runWorkflow(parent, {
      backend: new MockBackend(),
      journalDir: tmp(),
      runId: "nested-sandbox",
      workflowResolver: async () => child,
    });

    expect(res.result).toEqual({ dateBlocked: true, randBlocked: true });
  });
});
