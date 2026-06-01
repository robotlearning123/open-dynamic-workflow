# Project Status

Current public status as of 2026-06-01.

## Verification

The core release gates are:

```bash
npm run typecheck
npm run build
npm test
node tools/compare.mjs
node tools/crosscheck.mjs
npm pack --dry-run --json
```

Expected baseline from the latest local audit:

- TypeScript typecheck: passing.
- Build: passing.
- Vitest: 239 tests passing.
- Fidelity gate: 34/34, 100%.
- Journal cross-check: passing.
- Fresh public-export smoke: passing from a one-commit exported repo created with
  `npm run release:export -- <empty-dir>`; verified with `npm ci`, typecheck,
  build, 239 tests, fidelity, cross-check, and pack dry-run.
- Public GitHub Actions CI: passing on `main` in
  `robotlearning123/open-dynamic-workflow`.

## Release Notes

- Package version in `package.json`: `0.0.7`.
- Public repository: <https://github.com/robotlearning123/open-dynamic-workflow>.
- This public repository was seeded from a sanitized current tree, not from the
  old private repository history.
- CI uses GitHub-hosted `ubuntu-latest` runners for the public repository.

## Private Archive

- The original private history is retained separately in
  `robotlearning123/open-dynamic-workflow-private-archive`.
- Do not make that archive public unless its git history is rewritten and
  rescanned.

## Open-Source Checklist

- Re-run the verification commands above from a clean checkout.
- Confirm the current tree and full git history contain no private account labels, key prefixes, raw secrets, local paths that expose sensitive state, or internal handoff instructions.
- Confirm GitHub Actions are green on the exact commit to be released.
- Confirm the package tarball contains the README-linked docs needed by users, but not local build output, node_modules, coverage, or run scratch data.
- Confirm the release version, git tag, GitHub release, and npm package all refer to the same commit.
- Keep repository visibility changes and npm publishing as owner-approved operations.
