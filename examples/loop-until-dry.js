// loop-until-dry.js — repeatedly find items until 2 consecutive dry rounds.
// Terminates under MockBackend because the mock returns identical items every round,
// so round 2 has no fresh items -> dry increments -> loop exits at dry===2.
// A hard cap of 6 rounds guarantees termination regardless of backend behavior.
// Globals: agent, parallel, phase, log, args, budget

export const meta = {
  name: "loop-until-dry",
  description: "Iteratively find items via parallel finder agents; dedup by key(); stop after 2 consecutive dry rounds.",
  whenToUse: "Use when you need to exhaust a source that may require multiple sweeps (e.g. paginated search, incremental discovery).",
  phases: [
    { title: "Find", detail: "parallel finder agents per round" },
    { title: "Done", detail: "report confirmed items" },
  ],
};

// Schema for each finder agent: a list of discovered items.
const FINDER_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          category: { type: "string" },
        },
      },
    },
  },
};

// DECISION POINT — key(x) determines dedup identity.
// Changing this to include category makes items with the same id but different
// categories count as distinct. Currently deduplicates by id alone.
function key(x) {
  return x.id;
}

const query = (args && args.query) ? String(args.query) : "open research problems in motor cortex decoding";

const seen = new Set();
const confirmed = [];
let dry = 0;
let round = 0;
const MAX_ROUNDS = 6; // hard safety cap — guarantees termination under any backend

phase("Find");

while (dry < 2 && round < MAX_ROUNDS) {
  round++;
  log(`Round ${round} — dry streak: ${dry}`);

  // Three parallel finder agents; each may return overlapping results.
  const found = (await parallel([
    () => agent(
      `Find items related to: ${query}\nRound: ${round}, finder: A. Return up to 3 items.`,
      { label: `find:A:r${round}`, schema: FINDER_SCHEMA }
    ),
    () => agent(
      `Find items related to: ${query}\nRound: ${round}, finder: B. Return up to 3 items.`,
      { label: `find:B:r${round}`, schema: FINDER_SCHEMA }
    ),
    () => agent(
      `Find items related to: ${query}\nRound: ${round}, finder: C. Return up to 3 items.`,
      { label: `find:C:r${round}`, schema: FINDER_SCHEMA }
    ),
  ]))
    .filter(Boolean)
    .flatMap((r) => r.items || []);

  const fresh = found.filter((x) => !seen.has(key(x)));

  if (!fresh.length) {
    dry++;
    log(`No fresh items (dry=${dry})`);
    continue;
  }

  dry = 0;
  fresh.forEach((x) => seen.add(key(x)));
  confirmed.push(...fresh);
  log(`Found ${fresh.length} fresh items (total confirmed: ${confirmed.length})`);
}

phase("Done");
log(`Loop ended after ${round} round(s) with ${confirmed.length} confirmed items`);

return {
  rounds: round,
  confirmedCount: confirmed.length,
  confirmed,
};
