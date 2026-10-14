# Dead-code pass — 2026-10-14

Follow-up to Plan 017 Workstream A ([`execplans/plan-dead-code.md`](execplans/plan-dead-code.md),
ADR 0007), whose knip gate sits in `ci.yml` at the counts recorded in
[`execplans/knip-baseline/README.md`](execplans/knip-baseline/README.md). On
2026-10-14 the owner asked for the repos' accumulated rubbish to be cleared and
approved deleting code that is **provably** dead. Anything with doubt stays and
gets a row in [`BACKLOG.md`](BACKLOG.md).

Measured on a fresh worktree from `origin/master` (`a3224b7d`), pnpm 10.33.0
through the corepack shim, Node 22.23.3, knip 6.34.0.

## Baseline

| Gate | Result |
|---|---|
| `turbo run build --concurrency=2` | 45 / 45 tasks |
| knip production (`--max-issues 724`) | pass; true count **721** |
| knip default (`--max-issues 579 --treat-config-hints-as-errors`) | pass; true count **550** |
| `@mushi-mushi/admin` typecheck, lint, test (313 files, 2059 tests), build | pass, also after the deletion |
| `check:residue`, `check:design`, `check:nav-registry`, `check:dead-buttons`, `check:spine`, `check:admin-docs-coverage`, `check:console-knowledge`, `check:docs-stats` | pass after the deletion (docs-stats once the README glance counts were regenerated) |

**Not run:** the repo-wide `turbo run typecheck lint test` (only `apps/admin`
changed, and its four tasks ran), the Deno edge checks (no edge file changed),
the fresh-clone probe.

## Default-mode unused files (62)

Each was checked for its basename in every tracked file. The two committed
`knip-baseline/*.json` reports name every finding, so they do not count as a
reference.

| Group | Count | Verdict |
|---|---|---|
| `apps/admin` files no file names, untouched since before 2026-09-14, imported by no recent remote branch | 16 | **KILL** (C1, 1,044 lines) |
| `apps/admin` files no file names but changed in the last two weeks: `DashboardStatusBanner`, `FirecrawlStatusBanner`, `InventoryStatusBanner`, `SkillsReadout` | 4 | KEEP. The console IA rework is in flight; an orphan from this month may be about to be wired back |
| Manual tools: `apps/admin/scripts/capture-theme-matrix.mjs`, `packages/mcp/scripts/{generate-glama-json,reinstall-cursor-mcp,verify-stdio-install}.mjs` | 4 | KEEP. Each header documents how to run it |
| Named in other code or docs (`packages/agents/src/browser/*`, `qa-coverage/*`, `PageHelpPanel`, `TabbedSubNav`, …) | 38 | KEEP, BL-012 |

The 16 deleted: `ChartPanelHeader`, `CiStatusCell`, `InlineGithubSetupNudge`,
`IntegrationFormField`, `RepoReadinessStrip`, `SuggestIntegrationButton`,
`PdcaStatusBanner`, `NodeInstructionsPopover`, `ProjectSdkOriginButton`,
`ProjectSetupProgress`, `ReportUserSection`, `ReportsBannerShell`,
`integrationsModeUx`, `inventoryModeUx`, `platformReleaseProfile`,
`reportsModeUx`. No cascade: knip's file count fell by exactly 16 and nothing
new appeared.

## Not judged this pass

265 unused exports, 195 types, 6 duplicates, 4 unused dependencies, 15 unused
devDependencies, 2 unlisted dependencies (BL-012, BL-013). Several packages are
published, so a dependency or export finding has to be proved against the
package's entry points, not only the monorepo's importers.

## C9 schema

Not examined.

## After

| Gate | Before (true / ceiling) | After |
|---|---|---|
| knip production | 721 / 724 | **705**, ceiling 705 (704 fails) |
| knip default | 550 / 579 | **534**, ceiling 534 (533 fails) |

A deliberate unused export in a used file (`apps/admin/src/lib/mergeFix.ts`)
fails both gates. An export added to a file that is itself unused does not,
because knip counts the file and not its exports.
