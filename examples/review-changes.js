// review-changes.js — review a set of change dimensions, verify findings in parallel.
// Globals: agent, parallel, pipeline, phase, log, args, budget

export const meta = {
  name: "review-changes",
  description: "Review a list of change dimensions; verify each finding via parallel agents; filter by majority vote.",
  whenToUse: "Use when you have a structured list of code/document dimensions to review and want each finding cross-checked before acting on it.",
  phases: [
    { title: "Review", detail: "one reviewer agent per dimension" },
    { title: "Verify", detail: "parallel verifier agents per finding" },
    { title: "Filter", detail: "majority-vote filter" },
  ],
};

// Each dimension describes an aspect of the change to review.
const DIMENSIONS = [
  "correctness: logic errors, off-by-one, null dereferences",
  "security: injection, credential exposure, privilege escalation",
  "performance: N+1 queries, unnecessary allocations, hot-path regressions",
];

// Schema for the review agent: a list of findings per dimension.
const FINDINGS = {
  type: "object",
  required: ["dimension", "findings"],
  properties: {
    dimension: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "summary", "severity"],
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
};

// Schema for a verifier agent: a binary verdict on one finding.
const VERDICT = {
  type: "object",
  required: ["findingId", "confirmed"],
  properties: {
    findingId: { type: "string" },
    confirmed: { type: "boolean" },
    note: { type: "string" },
  },
};

// DECISION POINT — majority vs unanimous changes how many findings survive; tune here.
function survivesVerification(votes) {
  // majority: more than half of verifiers must confirm
  if (!votes || votes.length === 0) return false;
  const confirmed = votes.filter((v) => v && v.confirmed === true).length;
  return confirmed > votes.length / 2;
}

phase("Review");
log(`Reviewing ${DIMENSIONS.length} dimensions`);

// pipeline: each dimension -> reviewer -> parallel verifiers
// Stage 1: review agent returns { dimension, findings[] }
// Stage 2: for each finding, spawn a verifier agent; collect votes
const reviewed = await pipeline(
  DIMENSIONS,
  async (dimension) => {
    return await agent(
      `You are a code reviewer. Review the following dimension of a proposed change.\nDimension: ${dimension}\nReturn a structured review with findings.`,
      { label: `review:${dimension.split(":")[0]}`, schema: FINDINGS }
    );
  },
  async (review) => {
    if (!review || !review.findings || review.findings.length === 0) {
      return { dimension: review ? review.dimension : "unknown", confirmed: [] };
    }
    phase("Verify");
    const votes = await parallel(
      review.findings.map((f) => () =>
        agent(
          `Verify the following finding from a code review.\nFinding id: ${f.id}\nSummary: ${f.summary}\nSeverity: ${f.severity}\nDoes this finding accurately describe a real issue? Return your verdict.`,
          { label: `verify:${f.id}`, schema: VERDICT }
        )
      )
    );
    // Pair each finding with its votes
    return {
      dimension: review.dimension,
      findings: review.findings.map((f, idx) => ({
        ...f,
        votes: [votes[idx]],
      })),
    };
  }
);

phase("Filter");

// Flatten all findings across dimensions; filter by survivesVerification
const allFindings = (reviewed || [])
  .filter(Boolean)
  .flatMap((r) => (r.findings || []).map((f) => ({ ...f, dimension: r.dimension })));

const confirmed = allFindings.filter((f) => survivesVerification(f.votes));

log(`Total findings: ${allFindings.length}, confirmed after verification: ${confirmed.length}`);

return {
  totalDimensions: DIMENSIONS.length,
  totalFindings: allFindings.length,
  confirmedFindings: confirmed,
};
