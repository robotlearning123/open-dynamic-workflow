import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMeta, runWorkflowFile } from "../src/runner.js";
import { validate } from "../src/structured-output.js";
import { MockBackend } from "../src/backend.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "odw-rf-"));

describe("adversarial-review regressions", () => {
  // ---- M3: parseMeta must ignore comments (braces / "meta=" inside them) ----
  it("parseMeta skips braces and fake declarations inside comments [M3]", () => {
    const src = [
      "// header with a brace } and the words: export const meta = decoy",
      "/* block comment {{{ unbalanced, mentions export const meta = {} */",
      "export const meta = { name: 'real', description: 'd', phases: [{ title: 'p' }] };",
      "return 1;",
    ].join("\n");
    const m = parseMeta(src);
    expect(m.name).toBe("real");
    expect(m.description).toBe("d");
  });

  it("runs a workflow file whose header comment contains braces [M3]", async () => {
    const dir = tmp();
    const f = join(dir, "w.js");
    writeFileSync(f, "// comment with } brace and { brace\nexport const meta={name:'c',description:'d'};\nreturn 42;\n");
    const r = await runWorkflowFile(f, { backend: new MockBackend(), journalDir: join(dir, ".runs") });
    expect(r.result).toBe(42);
  });

  // ---- M4: stripExports tolerates indentation (and leaves `export default` alone) ----
  it("handles an indented `export const meta` [M4]", async () => {
    const dir = tmp();
    const f = join(dir, "w.js");
    writeFileSync(f, "  export const meta = { name: 'i', description: 'd' };\n  return 7;\n");
    const r = await runWorkflowFile(f, { backend: new MockBackend(), journalDir: join(dir, ".runs") });
    expect(r.result).toBe(7);
  });

  // ---- M5: validate rejects non-finite numbers ----
  it("validate rejects NaN / Infinity as number; accepts finite [M5]", () => {
    expect(validate(NaN, { type: "number" }).ok).toBe(false);
    expect(validate(Infinity, { type: "number" }).ok).toBe(false);
    expect(validate(-Infinity, { type: "number" }).ok).toBe(false);
    expect(validate(1.5, { type: "number" }).ok).toBe(true);
    expect(validate(3, { type: "integer" }).ok).toBe(true);
    expect(validate(NaN, { type: "integer" }).ok).toBe(false);
  });
});
