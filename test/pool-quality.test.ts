import { describe, it, expect } from "vitest";
import type { AgentBackend, AgentRequest, AgentResponse } from "../src/types.js";
import { withQualityEscalation } from "../src/pool-quality.js";

const be = (output: unknown, outputTokens = 1): AgentBackend => ({
  run: async (): Promise<AgentResponse> => ({ output, inputTokens: 1, outputTokens }),
});
const req = (over: Partial<AgentRequest> = {}): AgentRequest => ({ prompt: "do X", agentId: "a1", ...over });

describe("withQualityEscalation (Phase 2 — writer ≠ grader)", () => {
  it("escalates when the grade is below min, and grades with the 'quality-grader' agentType", async () => {
    const seen: Array<string | undefined> = [];
    const grader: AgentBackend = {
      run: async (r): Promise<AgentResponse> => {
        seen.push(r.agentType);
        return { output: { score: 0.2 }, inputTokens: 1, outputTokens: 1 };
      },
    };
    const g = withQualityEscalation(be("draft"), { grader, escalateTo: be("polished"), min: 0.6 });
    const r = await g.run(req());
    expect(r.output).toBe("polished");
    expect(seen).toContain("quality-grader");
  });

  it("keeps the primary output when the grade meets min (no escalation)", async () => {
    const g = withQualityEscalation(be("draft"), { grader: be({ score: 0.9 }), escalateTo: be("NOPE"), min: 0.6 });
    expect((await g.run(req())).output).toBe("draft");
  });

  it("skips grading entirely when when() is false (grader never called)", async () => {
    let graderCalls = 0;
    const grader: AgentBackend = {
      run: async (): Promise<AgentResponse> => { graderCalls++; return { output: { score: 0 }, inputTokens: 0, outputTokens: 0 }; },
    };
    const g = withQualityEscalation(be("draft"), { grader, when: (rq) => rq.agentType === "reviewer" });
    const r = await g.run(req()); // agentType undefined → when() false
    expect(r.output).toBe("draft");
    expect(graderCalls).toBe(0);
  });

  it("sums grading + escalation output tokens into the response (budget accounting)", async () => {
    const g = withQualityEscalation(be("draft", 3), { grader: be({ score: 0.1 }, 5), escalateTo: be("polished", 7), min: 0.6 });
    expect((await g.run(req())).outputTokens).toBe(3 + 5 + 7);
  });

  it("parses a numeric score from a plain-text grader response", async () => {
    const g = withQualityEscalation(be("draft"), { grader: be("I'd rate this 0.9 / 1.0"), escalateTo: be("polished"), min: 0.6 });
    expect((await g.run(req())).output).toBe("draft"); // 0.9 >= 0.6 → kept
  });
});
