# Trace Artifacts

This directory contains captured Workflow-tool runs used as behavioral evidence for the
differential fidelity gate. The JSONL transcripts preserve behavioral payloads, timestamps,
agent ids, and ordering metadata so the observations can be audited.

Privacy scrub status:

- Raw secrets and provider keys are not committed.
- Private skill-listing payloads and internal tool attachment bodies were stripped before commit.
- Capture-time local repository paths were replaced with `<repo-root>`.
- Provider request ids and capture session ids were replaced with `<request-id>` and `<session-id>`.

These traces are not included in the npm package tarball; they are repository evidence for
`tools/compare.mjs`, `tools/crosscheck.mjs`, `ANALYSIS.md`, and `RUNLOG.md`.
