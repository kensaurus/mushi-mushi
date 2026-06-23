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
- [ ] Positioning stays on-message (`pnpm check:narrative`) — hero, north-star, buyer, and the three "will not"s match [`/VISION.md`](../VISION.md); changed a tagline? update `packages/brand` first
- [ ] If MCP catalog changed: `pnpm gen:mcp-tools-doc && pnpm check:onboarding-drift`

### SDK widget tokens (only if this PR touches `packages/web/src/styles.ts`, `packages/web/src/build-widget-theme.ts`, or `packages/core/src/design-tokens.ts`)

- [ ] Colours flow through `@mushi-mushi/core` → `build-widget-theme.ts` — no new raw `#hex` in `styles.ts`
- [ ] `node scripts/check-design-tokens.mjs` passes (widget hex guard)
- [ ] `pnpm --filter @mushi-mushi/web lint` passes (`mushi-mushi/no-raw-hex-in-widget`)

### Admin console UX (only if this PR touches `apps/admin/src/pages/` or posture chrome)

- [ ] New operator worklist page uses `PagePosture` (status → snapshot → guide/readout) — see `apps/admin/src/design-system/page-posture-recipes.ts`
- [ ] Section tabs use `<SegmentedControl scrollable>` — not hand-rolled `role="tablist"`
- [ ] No duplicate "Needs attention" card when a status banner already surfaces the same priority
- [ ] `pnpm --filter @mushi-mushi/admin lint` passes (`no-hand-rolled-tablist`, `no-missing-page-posture`)
- [ ] Chrome budget: visible `[data-page-posture]` rows ≤ 2 (Beginner) / ≤ 3 (Advanced) — see `examples/e2e-dogfood/tests/admin-chrome-budget.spec.ts`
- [ ] Connect surfaces: client picker uses `<FilterChip tone="brand">`; lane tabs use `<SegmentedControl>`; install CTAs use `<ClientConnectButton>` — not hand-rolled chips/tabs/deeplink buttons
- [ ] Nav registry updated (`apps/admin/src/lib/navRegistry.ts`) if routes, sidebar labels, or palette keywords changed — `pnpm check:nav-registry`
- [ ] Quickstart copy avoids jargon (`PDCA`, `DLQ`, raw `MCP`) — `pnpm check:ia-labels`

### Supply-chain (only if this PR touches `.github/workflows/`, `scripts/`, package.json files, or adds/upgrades a dependency)

- [ ] Any new third-party GitHub Action is pinned to a 40-char commit SHA with a version comment (no `@v1`, `@main`)
- [ ] Any new dependency was added at the latest stable version *and* respects the 7-day cooldown (`pnpm install --frozen-lockfile` succeeds)
- [ ] No secrets, tokens, API keys, or credentials introduced (the pre-commit hook + `secret-scan.yml` will catch most leaks, but please double-check)
- [ ] If a new workflow was added, it has `permissions: contents: read` at the top level and only escalates per-job for the minimum needed
- [ ] If a new workflow was added, it starts with the `step-security/harden-runner` audit step
