# Project Status

Current status as of 2026-06-01.

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

## Release Notes

- Package version in `package.json`: `0.0.7`.
- Latest GitHub release observed during the 2026-06-01 audit: `v0.0.6`.
- Current feature branches that add behavior after `v0.0.6` should be released as `v0.0.7` or later before publishing.
- CI must target the ARC runner scale set directly with `runs-on: labclaw-arc`.

## Public Release Blockers

- Do not make the existing private GitHub repository public until its history is
  cleaned or the project is published from a fresh sanitized repository. Older
  commits include benchmark account labels and API-key prefixes in
  `docs/BENCHMARKS.md`; removing them from the current tree is not enough
  because public GitHub repositories expose commit history.
- Push the current local cleanup changes and wait for GitHub Actions to pass on
  the exact release commit before tagging or publishing.
- Create the `v0.0.7` git tag and GitHub release only after the sanitized release
  commit is pushed and CI is green.
- For a fresh public repository path, use `npm run release:export -- <empty-dir>`
  and publish from that exported tree instead of flipping this private repo public.

## Open-Source Checklist

Before making the repository public or publishing to npm:

Recommended safe path:
- Create a fresh public repository from a verified `npm run release:export -- <empty-dir>`
  output, then push/tag/release/publish from that fresh repo.
- Do not flip the existing private repository public unless its git history has first
  been rewritten and rescanned.

- Re-run the verification commands above from a clean checkout.
- Confirm the current tree and full git history contain no private account labels, key prefixes, raw secrets, local paths that expose sensitive state, or internal handoff instructions.
- Confirm GitHub Actions are green on the exact commit to be released.
- Confirm the package tarball contains the README-linked docs needed by users, but not local build output, node_modules, coverage, or run scratch data.
- Confirm the release version, git tag, GitHub release, and npm package all refer to the same commit.
- Keep repository visibility changes and npm publishing as owner-approved operations.
