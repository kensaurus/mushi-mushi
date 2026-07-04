# Documentation Statistics

Canonical counts for README badges, Helm docs, and integration tables.

## Commands

```bash
pnpm docs-stats        # human-readable summary
pnpm check:docs-stats  # fail if README counts drift
pnpm check:helm-migrations  # fail if deploy/helm/migrations is stale
pnpm gen:route-manifest     # regenerate docs/API_ROUTE_MANIFEST.generated.md
pnpm check:route-manifest   # fail if route manifest is stale
pnpm check:onboarding-drift # fail on phantom MCP/env/setup patterns in onboarding docs
pnpm check:env-docs         # fail if .env.example templates miss critical keys
```

## Sources of truth

| Stat | Source |
| :--- | :----- |
| TypeScript lines / files | Walk `packages/`, `apps/`, `examples/` (excludes tests) |
| Workspace / npm package counts | `packages/*/package.json` |
| Edge functions | Directories under `packages/server/supabase/functions/` (excludes `_shared`) |
| SQL migrations | `*.sql` in `packages/server/supabase/migrations/` |
| Helm mirror | `deploy/helm/migrations/` (sync via `pnpm sync:helm-migrations`) |
| Pipeline agents | Rows in `AGENTS.md` agent inventory table |
| Inbound adapters | `packages/adapters/src/*.ts` (excludes `index.ts`, `types.ts`) |
| Outbound plugins | `packages/plugin-*` packages (13 integrations + `@mushi-mushi/plugin-sdk` for builders) |

Snapshot file: [`stats.snapshot.json`](./stats.snapshot.json) (updated manually when major milestones ship).

Closed audit burndowns (including anti-slop plans): [`archive/plan-antislop/`](./archive/plan-antislop/).

## Adding a new claim-bearing number

1. Add a regex check to `buildReadmeClaimChecks()` in `scripts/lib/docs-stats.mjs`.
2. Update the markdown with the canonical value.
3. Run `pnpm check:docs-stats`.

## Refreshing Helm migrations

After adding SQL under `packages/server/supabase/migrations/`:

```bash
pnpm sync:helm-migrations
pnpm check:helm-migrations
```

Then update any prose that quotes the migration file count if `check:docs-stats` does not already guard it.

## NPM package README footers

Publishable packages under `packages/` include a `<!-- mushi-readme-stats-footer -->` block (visible on npmjs.com) linking here. When scale numbers change, update the footer month/counts in those READMEs to match `pnpm docs-stats`.
