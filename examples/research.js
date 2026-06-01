// research.js — multi-modal parallel sweep, deep-read pipeline, synthesis.
// Globals: agent, parallel, pipeline, phase, log, args, budget

export const meta = {
  name: "research",
  description: "Parallel multi-modal sweep across sources, deep-read pipeline, then synthesize a report.",
  whenToUse: "Use when you need to gather evidence from multiple modalities (text, code, data) and produce a synthesized report.",
  phases: [
    { title: "Sweep", detail: "parallel agents across three source modalities" },
    { title: "Deep-read", detail: "two-stage pipeline: extract then enrich" },
    { title: "Synthesize", detail: "single synthesis agent" },
  ],
};

// Topic comes from args or falls back to a default.
const topic = (args && args.topic) ? String(args.topic) : "neural population dynamics in motor cortex";

// Schema for sweep agents: a list of source snippets.
const SWEEP_SCHEMA = {
  type: "object",
  required: ["modality", "snippets"],
  properties: {
    modality: { type: "string" },
    snippets: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          relevance: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
};

// Schema for deep-read stage 1: extracted key claims.
const EXTRACT_SCHEMA = {
  type: "object",
  required: ["snippetId", "claims"],
  properties: {
    snippetId: { type: "string" },
    claims: {
      type: "array",
      items: { type: "string" },
    },
  },
};

// Schema for deep-read stage 2: enriched claim with evidence.
const ENRICH_SCHEMA = {
  type: "object",
  required: ["snippetId", "enrichedClaims"],
  properties: {
    snippetId: { type: "string" },
    enrichedClaims: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "evidence"],
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

phase("Sweep");
log(`Sweeping three modalities for topic: ${topic}`);

// Parallel sweep across three modalities.
const sweepResults = await parallel([
  () => agent(
    `Search literature (text modality) for evidence about: ${topic}. Return relevant snippets.`,
    { label: "sweep:literature", schema: SWEEP_SCHEMA, model: "sonnet" }
  ),
  () => agent(
    `Search code repositories (code modality) for implementations related to: ${topic}. Return relevant snippets.`,
    { label: "sweep:code", schema: SWEEP_SCHEMA, model: "sonnet" }
  ),
  () => agent(
    `Search datasets and benchmarks (data modality) for measurements related to: ${topic}. Return relevant snippets.`,
    { label: "sweep:data", schema: SWEEP_SCHEMA, model: "sonnet" }
  ),
]);

// Collect all snippets across modalities (filter nulls from parallel failures).
const allSnippets = (sweepResults || [])
  .filter(Boolean)
  .flatMap((r) => (r.snippets || []).map((s) => ({ ...s, modality: r.modality })));

log(`Sweep collected ${allSnippets.length} snippets across modalities`);

phase("Deep-read");

// pipeline: two-stage per snippet — extract claims, then enrich with evidence.
// Stage 1 (extract): returns EXTRACT_SCHEMA object; prev === item (snippet)
// Stage 2 (enrich): receives stage-1 output; returns ENRICH_SCHEMA object
const deepRead = await pipeline(
  allSnippets,
  async (snippet) => {
    return await agent(
      `Extract the key factual claims from the following research snippet.\nSnippet id: ${snippet.id}\nModality: ${snippet.modality}\nText: ${snippet.text}`,
      { label: `extract:${snippet.id}`, schema: EXTRACT_SCHEMA }
    );
  },
  async (extracted, snippet) => {
    if (!extracted || !extracted.claims || extracted.claims.length === 0) {
      return { snippetId: snippet.id, enrichedClaims: [] };
    }
    return await agent(
      `Enrich the following claims with supporting evidence from the source snippet.\nSnippet id: ${snippet.id}\nClaims: ${JSON.stringify(extracted.claims)}\nOriginal text: ${snippet.text}`,
      { label: `enrich:${snippet.id}`, schema: ENRICH_SCHEMA }
    );
  }
);

const enrichedItems = (deepRead || []).filter(Boolean);
log(`Deep-read enriched ${enrichedItems.length} snippets`);

phase("Synthesize");

// Single synthesis agent ingests all enriched claims and produces a report.
const report = await agent(
  `Synthesize a concise research report on the following topic based on the enriched evidence below.\nTopic: ${topic}\nEvidence: ${JSON.stringify(enrichedItems, null, 2)}`,
  {
    label: "synth",
    schema: {
      type: "object",
      required: ["topic", "summary", "keyFindings"],
      properties: {
        topic: { type: "string" },
        summary: { type: "string" },
        keyFindings: {
          type: "array",
          items: { type: "string" },
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
  }
);

return {
  topic,
  sweepCount: allSnippets.length,
  enrichedCount: enrichedItems.length,
  report,
};
