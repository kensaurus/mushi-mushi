## What

Brief description of the change.

## Why

Context and motivation.

## How

Implementation approach (if non-obvious).

## Checklist

- [ ] TypeScript compiles (`pnpm typecheck`)
- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Changeset added (if modifying a published package)
- [ ] Documentation updated (if API changed)

### Supply-chain (only if this PR touches `.github/workflows/`, `scripts/`, package.json files, or adds/upgrades a dependency)

- [ ] Any new third-party GitHub Action is pinned to a 40-char commit SHA with a version comment (no `@v1`, `@main`)
- [ ] Any new dependency was added at the latest stable version *and* respects the 7-day cooldown (`pnpm install --frozen-lockfile` succeeds)
- [ ] No secrets, tokens, API keys, or credentials introduced (the pre-commit hook + `secret-scan.yml` will catch most leaks, but please double-check)
- [ ] If a new workflow was added, it has `permissions: contents: read` at the top level and only escalates per-job for the minimum needed
- [ ] If a new workflow was added, it starts with the `step-security/harden-runner` audit step
