import { describe, it, expect } from "vitest";
import { TreeReporter, silentReporter } from "../src/progress.js";

function capture() {
  const chunks: string[] = [];
  const stream = { write: (s: string | Uint8Array) => (chunks.push(String(s)), true) } as unknown as NodeJS.WritableStream;
  return { stream, out: () => chunks.join("") };
}

describe("TreeReporter", () => {
  it("renders every event kind to the stream", () => {
    const c = capture();
    const r = new TreeReporter({ stream: c.stream });
    r.emit({ kind: "phase", title: "Review" });
    r.emit({ kind: "log", message: "hello" });
    r.emit({ kind: "agent-start", ordinal: 1, agentId: "a001", label: "rev", phase: "Review", cached: false });
    r.emit({ kind: "agent-done", ordinal: 1, agentId: "a001", label: "rev", phase: "Review", cached: false, outputTokens: 12 });
    r.emit({ kind: "agent-fail", ordinal: 2, agentId: "a002", label: "bad", phase: "Review", error: "boom" });
    const out = c.out();
    expect(out).toContain("[phase] Review");
    expect(out).toContain(">> hello");
    expect(out).toContain('#1 a001 "rev"');
    expect(out).toContain("starting...");
    expect(out).toContain("done (12 tokens)");
    expect(out).toContain("FAILED: boom");
  });

  it("marks cached agents", () => {
    const c = capture();
    new TreeReporter({ stream: c.stream }).emit({ kind: "agent-start", ordinal: 1, agentId: "a1", label: "x", phase: "P", cached: true });
    expect(c.out()).toContain("(cached)");
  });

  it("defaults to process.stderr when no stream given", () => {
    expect(() => new TreeReporter().emit({ kind: "log", message: "to-stderr" })).not.toThrow();
  });

  it("silentReporter emits nothing and never throws", () => {
    expect(() => silentReporter.emit({ kind: "phase", title: "x" })).not.toThrow();
  });
});
