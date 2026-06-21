<!--
  BEFORE YOU OPEN THIS PR
  • Branch from master and target master — PRs to any other base are closed automatically.
  • Claim the issue first by commenting on it, so two people don't duplicate work.
  • No automated / AI-generated / bulk submissions. One PR per issue, one issue per PR.
  See CONTRIBUTING.md §"What we don't accept" for the full policy.
-->

## What

Brief description of the change.

## Why

Context and motivation.

## How

Implementation approach (if non-obvious).

## Checklist

- [ ] **I am a human.** This PR was not generated or submitted by an automated script or bulk tool.
- [ ] **I read the linked issue** and my PR addresses what it actually asks for.
- [ ] **This PR targets `master`** (not `main` or any other branch).
- [ ] TypeScript compiles (`pnpm typecheck`)
- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Changeset added (if modifying a published package)
- [ ] Documentation updated (if API changed)
- [ ] Repositioning copy labels unshipped features as **Target** (not shipped)
- [ ] If MCP catalog changed: `pnpm gen:mcp-tools-doc && pnpm check:onboarding-drift`

### Supply-chain (only if this PR touches `.github/workflows/`, `scripts/`, package.json files, or adds/upgrades a dependency)

- [ ] Any new third-party GitHub Action is pinned to a 40-char commit SHA with a version comment (no `@v1`, `@main`)
- [ ] Any new dependency was added at the latest stable version *and* respects the 7-day cooldown (`pnpm install --frozen-lockfile` succeeds)
- [ ] No secrets, tokens, API keys, or credentials introduced (the pre-commit hook + `secret-scan.yml` will catch most leaks, but please double-check)
- [ ] If a new workflow was added, it has `permissions: contents: read` at the top level and only escalates per-job for the minimum needed
- [ ] If a new workflow was added, it starts with the `step-security/harden-runner` audit step
