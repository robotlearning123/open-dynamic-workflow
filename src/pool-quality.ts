/**
 * pool-quality.ts — Phase 2: quality-escalation hook (writer ≠ grader).
 *
 * Wraps a primary AgentBackend: after the (cheap) primary produces output, a
 * STRONGER grader backend scores it; if the score is below threshold, the request
 * is re-run on an escalation backend. This is the runtime form of the project's
 * cross-model-review rule — the cheap worker writes, a different/stronger model grades.
 *
 * Pure composition over AgentBackend — no engine changes, runs outside the sandbox.
 * Grading + escalation output tokens are summed into the returned response so the
 * run budget accounts for them.
 */

import type { AgentBackend, AgentRequest, AgentResponse, JsonSchema } from "./types.js";

export interface QualityOptions {
  /** Stronger backend that grades the primary's output (should differ from the writer). */
  grader: AgentBackend;
  /** Backend to re-run on when the grade is below `min`. Default: the grader. */
  escalateTo?: AgentBackend;
  /** Minimum acceptable score in [0,1]. Default 0.6. */
  min?: number;
  /** Only grade requests for which this returns true. Default: always. */
  when?: (req: AgentRequest) => boolean;
  /** Build the grading prompt from the request + the primary's output. */
  gradePrompt?: (req: AgentRequest, output: unknown) => string;
  /** Parse a 0..1 score from the grader's output. Default: reads `.score` or first number. */
  parseScore?: (graderOutput: unknown) => number;
  /** Optional logger for grade/keep/escalate events. */
  log?: (m: string) => void;
}

/** JSON schema forced on the grader so it returns a structured score. */
const SCORE_SCHEMA: JsonSchema = {
  type: "object",
  properties: { score: { type: "number" }, reason: { type: "string" } },
  required: ["score"],
};

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

function defaultGradePrompt(req: AgentRequest, output: unknown): string {
  const out = typeof output === "string" ? output : JSON.stringify(output);
  return (
    `Grade the following response on a 0.0–1.0 quality scale (1.0 = excellent, correct, complete). ` +
    `Be strict.\n\nTASK:\n${req.prompt}\n\nRESPONSE:\n${out}\n\n` +
    `Return JSON {"score": <0..1>, "reason": "<short>"}.`
  );
}

function defaultParseScore(o: unknown): number {
  if (o !== null && typeof o === "object" && "score" in o) {
    const s = (o as { score: unknown }).score;
    if (typeof s === "number") return clamp01(s);
  }
  const m = /(\d+(?:\.\d+)?)/.exec(String(o));
  return m !== null && m[1] !== undefined ? clamp01(parseFloat(m[1])) : 0;
}

/**
 * Wrap a primary backend with quality-grading escalation.
 *
 * @example
 * const pool = definePool({ ... });            // cheap workers
 * const graded = withQualityEscalation(pool, {
 *   grader: new AnthropicBackend({ defaultModel: "claude-opus-4-8" }),
 *   when: (req) => req.agentType === "reviewer",
 *   min: 0.7,
 * });
 * // use `graded` as RunConfig.backend
 */
export function withQualityEscalation(primary: AgentBackend, opts: QualityOptions): AgentBackend {
  const min = opts.min ?? 0.6;
  const when = opts.when ?? ((): boolean => true);
  const escalateTo = opts.escalateTo ?? opts.grader;
  const gradePrompt = opts.gradePrompt ?? defaultGradePrompt;
  const parseScore = opts.parseScore ?? defaultParseScore;
  const log = opts.log ?? ((): void => undefined);

  return {
    async run(req: AgentRequest): Promise<AgentResponse> {
      const first = await primary.run(req);
      if (!when(req)) return first;

      const gradeReq: AgentRequest = {
        prompt: gradePrompt(req, first.output),
        schema: SCORE_SCHEMA,
        agentId: `${req.agentId}:grade`,
        agentType: "quality-grader",
      };
      const graded = await opts.grader.run(gradeReq);
      const score = parseScore(graded.output);

      if (score >= min) {
        log(`quality: ${req.agentId} score=${score.toFixed(2)} >= ${min} — kept`);
        return { ...first, outputTokens: first.outputTokens + graded.outputTokens };
      }

      log(`quality: ${req.agentId} score=${score.toFixed(2)} < ${min} — escalating`);
      const better = await escalateTo.run({ ...req, agentId: `${req.agentId}:escalated` });
      return {
        output: better.output,
        inputTokens: first.inputTokens + graded.inputTokens + better.inputTokens,
        outputTokens: first.outputTokens + graded.outputTokens + better.outputTokens,
      };
    },
  };
}
