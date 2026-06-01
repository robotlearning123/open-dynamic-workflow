import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkflowFile, MockBackend } from "../src/index.js";

describe("named-workflow registry + nesting", () => {
  it("resolves workflow('name') via cfg.workflows and runs it one level deep", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odw-reg-"));
    const child = join(dir, "child.js");
    const parent = join(dir, "parent.js");
    writeFileSync(child, "export const meta={name:'child',description:'c'};\nreturn {from:'child'};\n");
    writeFileSync(
      parent,
      "export const meta={name:'parent',description:'p'};\nconst r = await workflow('child');\nreturn {got:r};\n",
    );
    const res = await runWorkflowFile(parent, {
      backend: new MockBackend(),
      journalDir: join(dir, ".runs"),
      workflows: { child },
    });
    expect(res.result).toEqual({ got: { from: "child" } });
  });
});
