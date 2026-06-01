import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chainKey, createJournal } from "../src/journal.js";
import type { AgentOpts } from "../src/types.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "odw-jrnl-"));

/** Compute the prefix-chained keys for a sequence of calls (invocation order). */
function chainAll(calls: Array<{ prompt: string; opts?: AgentOpts }>): string[] {
  let chain = "";
  const keys: string[] = [];
  for (const c of calls) {
    const r = chainKey(chain, c.prompt, c.opts ?? {});
    keys.push(r.key);
    chain = r.chain;
  }
  return keys;
}

describe("chainKey (prefix-chained cache key)", () => {
  it("is deterministic and v2-prefixed", () => {
    expect(chainKey("", "hello", {}).key).toBe(chainKey("", "hello", {}).key);
    expect(chainKey("", "hello", {}).key.startsWith("v2:")).toBe(true);
  });

  it("editing an earlier call cascades to all later keys (traces/experiment-06)", () => {
    const base = chainAll([{ prompt: "A1" }, { prompt: "B1" }, { prompt: "C1" }, { prompt: "D1" }]);
    const edited = chainAll([{ prompt: "A1" }, { prompt: "B2" }, { prompt: "C1" }, { prompt: "D1" }]);
    expect(edited[0]).toBe(base[0]); // A: before the edit -> unchanged
    expect(edited[1]).not.toBe(base[1]); // B: edited
    expect(edited[2]).not.toBe(base[2]); // C: identical prompt, but prefix changed -> cascades
    expect(edited[3]).not.toBe(base[3]); // D: cascades
  });

  it("schema/model/agentType/isolation affect the key; label does not", () => {
    expect(chainKey("", "p", { model: "haiku" }).key).not.toBe(chainKey("", "p", { model: "sonnet" }).key);
    expect(chainKey("", "p", { model: "haiku" }).key).toBe(chainKey("", "p", { model: "haiku", label: "x" }).key);
  });

  it("no separator collision: ('ab','c d') vs ('ab c','d') produce different keys", () => {
    expect(chainKey("ab", "c d", {}).key).not.toBe(chainKey("ab c", "d", {}).key);
  });
});

describe("createJournal (content-addressed resume)", () => {
  it("resume serves prior results by key; misses unknown keys", () => {
    const dir = tmp();
    const [kA, kB] = chainAll([{ prompt: "A" }, { prompt: "B" }]);
    const j1 = createJournal({ runId: "r1", dir });
    j1.recordStarted(kA!, "a1");
    j1.recordResult(kA!, "a1", "RA");
    j1.recordStarted(kB!, "a2");
    j1.recordResult(kB!, "a2", "RB");

    const j2 = createJournal({ runId: "r2", dir, resumeFromRunId: "r1" });
    expect(j2.lookup(kA!)).toEqual({ hit: true, result: "RA" });
    expect(j2.lookup(kB!)).toEqual({ hit: true, result: "RB" });
    expect(j2.lookup("v2:nope")).toEqual({ hit: false });
  });

  it("a fresh run (no resume) does not see another run's keys", () => {
    const dir = tmp();
    const k = chainKey("", "X", {}).key;
    const j1 = createJournal({ runId: "r1", dir });
    j1.recordStarted(k, "a1");
    j1.recordResult(k, "a1", "RX");
    expect(createJournal({ runId: "r2", dir }).lookup(k)).toEqual({ hit: false });
  });

  it("re-using a runId without resume truncates the prior journal", () => {
    const dir = tmp();
    const k = chainKey("", "X", {}).key;
    const j1 = createJournal({ runId: "r", dir });
    j1.recordStarted(k, "a1");
    j1.recordResult(k, "a1", "old");
    createJournal({ runId: "r", dir }); // fresh run, same id -> truncates r
    expect(createJournal({ runId: "r2", dir, resumeFromRunId: "r" }).lookup(k)).toEqual({ hit: false });
  });

  it("rejects path-traversal runId / resumeFromRunId (SECURITY: cannot escape the journal dir)", () => {
    const dir = tmp();
    expect(() => createJournal({ runId: "../../etc/evil", dir })).toThrow(/unsafe runId/);
    expect(() => createJournal({ runId: "ok", dir, resumeFromRunId: "../../../tmp/x" })).toThrow(/unsafe resumeFromRunId/);
    expect(() => createJournal({ runId: "a/b", dir })).toThrow(/unsafe runId/);
    // legitimate auto-derived / CLI ids still work:
    expect(() => createJournal({ runId: "wf_0e550857c949", dir })).not.toThrow();
  });
});
