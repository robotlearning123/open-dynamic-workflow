import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentOpts, Journal, JournalEvent } from "./types.js";

/** Recursively sort object keys so the stringification is stable regardless of insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Prefix-CHAINED cache key (ANALYSIS §6 + traces/experiment-06). `key_n` mixes the running
 * `prevChain` digest (everything invoked before this call, in invocation order) with this call's
 * prompt + the key-relevant opts. Returns the key AND the advanced chain for the next call.
 *
 * Consequences (both empirically observed):
 *  - editing one call changes its key, which changes every LATER call's chain → all later keys
 *    change → prefix re-runs on resume (experiment-06);
 *  - reordering concurrent calls changes the chain from that point → those keys change
 *    (experiment-02 partial cache).
 */
export function chainKey(prevChain: string, prompt: string, opts: AgentOpts): { key: string; chain: string } {
  const optsDigest = stableStringify({
    schema: opts.schema ?? null,
    model: opts.model ?? null,
    agentType: opts.agentType ?? null,
    isolation: opts.isolation ?? null,
  });
  const chain = sha(prevChain + "\u0000" + prompt + "\u0000" + optsDigest);
  return { key: "v2:" + chain, chain };
}

export function createJournal(o: { runId: string; dir: string; resumeFromRunId?: string }): Journal {
  const { runId, dir, resumeFromRunId } = o;

  // SECURITY: runId / resumeFromRunId become filesystem path segments (join(dir, runId, ...)).
  // Reject anything that could traverse outside the journal dir (e.g. "../../etc"). Auto-derived
  // runIds ("wf_"+hex) and CLI/test ids satisfy this allowlist. See SECURITY.md.
  const SAFE_RUNID = /^[A-Za-z0-9_-]{1,128}$/;
  for (const [label, v] of [["runId", runId], ["resumeFromRunId", resumeFromRunId]] as const) {
    if (v !== undefined && !SAFE_RUNID.test(v)) {
      throw new Error(`createJournal: unsafe ${label} ${JSON.stringify(v)} — must match ${String(SAFE_RUNID)}`);
    }
  }

  const runDir = join(dir, runId);
  mkdirSync(runDir, { recursive: true });
  const journalPath = join(runDir, "journal.jsonl");

  // A fresh run (or a resume into a NEW run dir) starts with a clean journal so that re-using a
  // runId does not append stale events. Resume-in-place (resumeFromRunId === runId) keeps the file:
  // it is both the prior source we read and the file we append the delta to.
  if (resumeFromRunId !== runId) {
    writeFileSync(journalPath, "", "utf8");
  }

  // Content-addressed prior results: key -> result, loaded from the resumed run's journal.
  const prior = new Map<string, unknown>();
  if (resumeFromRunId !== undefined) {
    const priorPath = join(dir, resumeFromRunId, "journal.jsonl");
    if (existsSync(priorPath)) {
      for (const line of readFileSync(priorPath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let ev: JournalEvent;
        try {
          ev = JSON.parse(t) as JournalEvent;
        } catch {
          continue;
        }
        if (ev.type === "result") prior.set(ev.key, ev.result);
      }
    }
  }

  const append = (event: JournalEvent): void => {
    appendFileSync(journalPath, JSON.stringify(event) + "\n", "utf8");
  };

  return {
    runId,
    path: journalPath,
    lookup(key: string): { hit: true; result: unknown } | { hit: false } {
      return prior.has(key) ? { hit: true, result: prior.get(key) } : { hit: false };
    },
    recordStarted(key: string, agentId: string): void {
      append({ type: "started", key, agentId });
    },
    recordResult(key: string, agentId: string, result: unknown): void {
      append({ type: "result", key, agentId, result });
    },
    flush(): void {
      /* appendFileSync is synchronous; nothing to flush. */
    },
  };
}
