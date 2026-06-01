#!/usr/bin/env python3
"""Harvest a real dynamic-workflow run into exhaustive, version-controllable digests.

Input : a harvested run dir containing journal.jsonl + agent-<id>.jsonl(+.meta.json).
Output: <run>/../parsed/{journal.json, agents.json, digest.md, system-attachments/*.txt}

Goal: "log everything" — turn the raw transcripts (the real working log) into a
machine-readable + human-readable ground truth for a 1:1 reproduction. Every fact in
ANALYSIS.md should be traceable to a field this script extracts.

Usage: python3 tools/harvest_trace.py <run_dir> [--out <parsed_dir>]
"""
import json, sys, os, glob, argparse
from datetime import datetime


def load_jsonl(path):
    out = []
    with open(path) as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                out.append({"_parse_error": str(e), "_line": ln, "_raw": line[:200]})
    return out


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def text_of(content):
    """Flatten a message.content (str | list of blocks) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                parts.append(b.get("text", ""))
        return "\n".join(parts)
    return ""


def summarize_agent(path):
    events = load_jsonl(path)
    agent_id = None
    prompt = None
    model = None
    usage = {}
    tool_uses = []      # [{name, input}]
    tool_results = []   # [stringified]
    assistant_texts = []
    attachments = []    # raw attachment blobs
    timestamps = []

    for ev in events:
        agent_id = agent_id or ev.get("agentId")
        ts = parse_ts(ev.get("timestamp"))
        if ts:
            timestamps.append(ts)
        etype = ev.get("type")
        msg = ev.get("message") if isinstance(ev.get("message"), dict) else None

        if etype == "attachment":
            attachments.append(ev.get("attachment"))
            continue

        if etype == "user" and msg and prompt is None:
            prompt = text_of(msg.get("content"))

        if etype == "assistant" and msg:
            model = msg.get("model", model)
            u = msg.get("usage")
            if isinstance(u, dict):
                usage = u  # keep last (final) usage
            content = msg.get("content")
            if isinstance(content, list):
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use":
                        tool_uses.append({"name": b.get("name"), "input": b.get("input")})
                    elif b.get("type") == "text":
                        assistant_texts.append(b.get("text", ""))

        if etype == "user" and msg:
            content = msg.get("content")
            if isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        c = b.get("content")
                        tool_results.append(c if isinstance(c, str) else json.dumps(c)[:500])

    # The "return value" of the agent: StructuredOutput tool input if present, else final text.
    structured = next((t["input"] for t in tool_uses if t.get("name") == "StructuredOutput"), None)
    result = structured if structured is not None else ("\n".join(assistant_texts).strip() or None)

    start = min(timestamps) if timestamps else None
    end = max(timestamps) if timestamps else None
    return {
        "agentId": agent_id,
        "file": os.path.basename(path),
        "n_events": len(events),
        "model": model,
        "usage": usage,
        "prompt": prompt,
        "n_attachments": len(attachments),
        "attachments": attachments,
        "tool_uses": tool_uses,
        "tool_results": tool_results,
        "result": result,
        "result_kind": "structured" if structured is not None else "text",
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "duration_s": (end - start).total_seconds() if start and end else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    run_dir = os.path.abspath(args.run_dir)
    out = os.path.abspath(args.out) if args.out else os.path.join(os.path.dirname(run_dir), "parsed")
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(out, "system-attachments"), exist_ok=True)

    # Journal
    jpath = os.path.join(run_dir, "journal.jsonl")
    journal = load_jsonl(jpath) if os.path.exists(jpath) else []
    errors = [e for e in journal if "_parse_error" in e]

    # Agents
    agent_files = sorted(glob.glob(os.path.join(run_dir, "agent-*.jsonl")))
    agents = [summarize_agent(p) for p in agent_files]
    for a in agents:
        errors += [t for t in [] ]  # placeholder; agent parse errors captured as events

    # Cross-reference journal <-> agents
    started = {e["agentId"]: e["key"] for e in journal if e.get("type") == "started"}
    results = {e["agentId"]: e.get("result") for e in journal if e.get("type") == "result"}
    for a in agents:
        a["journal_key"] = started.get(a["agentId"])
        a["journal_result_matches"] = (
            json.dumps(results.get(a["agentId"]), sort_keys=True) == json.dumps(a["result"], sort_keys=True)
            if a["agentId"] in results else None
        )

    # Save shared attachments once (dedupe by content hash-ish) — the injected subagent system text.
    seen = {}
    for a in agents:
        for i, att in enumerate(a.get("attachments") or []):
            blob = json.dumps(att, indent=2, default=str)
            key = blob[:80]
            if key not in seen:
                idx = len(seen)
                fn = os.path.join(out, "system-attachments", f"attachment-{idx:02d}.txt")
                with open(fn, "w") as f:
                    f.write(blob)
                seen[key] = os.path.basename(fn)

    # Strip bulky attachments from machine json (kept separately above)
    agents_lean = []
    for a in agents:
        b = dict(a)
        b["attachments"] = f"[{a['n_attachments']} attachment(s) saved under system-attachments/]"
        agents_lean.append(b)

    with open(os.path.join(out, "journal.json"), "w") as f:
        json.dump(journal, f, indent=2, default=str)
    with open(os.path.join(out, "agents.json"), "w") as f:
        json.dump(agents_lean, f, indent=2, default=str)

    # Human digest
    lines = []
    lines.append(f"# Trace digest — {os.path.basename(os.path.dirname(run_dir)) or run_dir}\n")
    lines.append(f"- run dir: `{run_dir}`")
    lines.append(f"- agents: {len(agents)}  | journal events: {len(journal)}  | parse errors: {len(errors)}\n")

    lines.append("## Journal (append-only, 2-event model)\n")
    lines.append("| seq | type | agentId | key (v2:...) | result preview |")
    lines.append("|----|------|---------|--------------|----------------|")
    for i, e in enumerate(journal, 1):
        if "_parse_error" in e:
            lines.append(f"| {i} | PARSE_ERR | | | {e['_raw'][:40]} |")
            continue
        k = (e.get("key") or "")[:18]
        r = e.get("result")
        rp = (json.dumps(r)[:50] + "…") if r is not None else ""
        lines.append(f"| {i} | {e.get('type')} | {e.get('agentId','')} | {k} | {rp.replace('|','¦')} |")

    lines.append("\n## Agents (per-subagent ground truth)\n")
    for a in agents:
        lines.append(f"### {a['agentId']}  ({a['file']})")
        lines.append(f"- model: `{a['model']}`  | events: {a['n_events']}  | result_kind: **{a['result_kind']}**")
        lines.append(f"- usage: `{json.dumps(a['usage'])}`")
        lines.append(f"- window: {a['start']} → {a['end']}  ({a['duration_s']}s)")
        lines.append(f"- journal_key: `{a['journal_key']}`  | result_matches_journal: {a['journal_result_matches']}")
        lines.append(f"- tools: {[t['name'] for t in a['tool_uses']]}")
        if a["prompt"]:
            lines.append(f"- prompt: `{a['prompt'][:160].replace(chr(10),' ')}…`")
        rp = json.dumps(a["result"])[:200] if a["result"] is not None else "None"
        lines.append(f"- result: `{rp}`\n")

    # Concurrency / interleaving evidence from real timestamps
    lines.append("## Concurrency evidence (real wall-clock intervals)\n")
    iv = [(a["agentId"], parse_ts(a["start"]), parse_ts(a["end"])) for a in agents if a["start"] and a["end"]]
    iv.sort(key=lambda x: x[1] or datetime.max)
    lines.append("Sorted by start; overlaps prove concurrent execution.\n")
    lines.append("| agentId | start | end |")
    lines.append("|---------|-------|-----|")
    for aid, s, e in iv:
        lines.append(f"| {aid} | {s.isoformat() if s else ''} | {e.isoformat() if e else ''} |")

    with open(os.path.join(out, "digest.md"), "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"OK parsed {len(agents)} agents, {len(journal)} journal events, {len(errors)} errors")
    print(f"wrote: {out}/journal.json, agents.json, digest.md, system-attachments/")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
