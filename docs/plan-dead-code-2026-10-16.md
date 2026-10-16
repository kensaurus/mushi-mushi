# Dead-code pass — 2026-10-16

Second pass under the owner's 2026-10-14 approval ([`plan-dead-code-2026-10-14.md`](plan-dead-code-2026-10-14.md)):
delete what is **provably** dead, and keep anything in doubt with a row in [`BACKLOG.md`](BACKLOG.md).
The first pass judged only files. This pass judged what it left: files, exports, types and
dependencies.

Measured on branch `housekeep/2026-10-16-deadcode` (base `76592f11`, master `c37eff30` plus one
commit), pnpm 10.33.0, Node 22.23.2, knip 6.34.0, after `pnpm build`.

## Method

- **Files.** Each finding was checked for an import in every branch ref updated since 2026-09-01
  (272 refs) and in every sibling worktree, not only in `HEAD`. The only hits were 2026-10-04
  console-overhaul sub-branches that #434 squash-merged, and #434 is the commit that removed those
  imports. The deletion set was diffed against the approved list before committing.
- **Exports and types.** `knip --fix-type exports,types` ran once per workspace, because a
  repo-wide run edits nothing on this setup. The repo builds with `noUnusedLocals`, so TypeScript's
  own `unusedIdentifier_delete` and `unusedIdentifier_deleteImports` code fixes then removed the
  declarations un-exporting had orphaned. They looped until the tree typechecked. Every export
  finding in a published package sits in a module that no `package.json` `exports` entry or tsup
  entry reaches, so no published API changed (`check:sdk-api-surface` and `check:package-types`
  pass).
- **Text consumers.** Scripts that read source as text or load it through jiti were checked by
  running every check step in `ci.yml` after each round.
- **Dependencies.** Each finding was checked against source, config strings, CSS `@import`,
  vitest aliases and the turbo task graph.
- **Design lane.** Files that are clearly design-system (`components/ui/*`, tokens, chip tones,
  motion tokens, flow primitives, icons, charts and the page scaffold) were left to the parallel
  design housekeep, and their findings were handed over.

## Commits

| # | Category | Items | Cascade | Gates after | Commit |
|---|---|---|---|---|---|
| 1 | C1 files | 32 files, 3,599 lines | none in that round | admin + agents typecheck, test (2058 + 100), build; docs build | `bfe404a8` |
| 2 | C2 + C3, round 1 | 211 exports and 184 types un-exported or removed with the declarations they orphaned | `ConnectStepLaneReadout.tsx` became unused | full typecheck (53), lint, test (87 tasks), `test:scripts`, build (45), every `ci.yml` check | `66b3a54c` |
| 3 | C1 cascade | 1 file | none | admin typecheck, test, build | `686b76b8` |
| 4 | C2, round 2 | 2 types | counts stopped moving | admin typecheck, lint, test, build | `0f6b6015` |
| 5 | changeset | patch for cli, mcp-ci, node, react-native, ux, wasm-classifier (core and web already had one) | — | `check-changeset-coverage`, `changelog:check`, `check:changeset-orphans` | `e8fd7a24` |
| 6 | C4 dependencies | 11 | none | frozen install, full build and typecheck, tests of the 5 touched workspaces, `check:package-types`, `check:install-size`, publish readiness | `a93b6736` |
| 7 | ratchet | `ci.yml` 705 → 282, 534 → 95; baselines regenerated | — | 282/95 pass, 281/94 fail | `4a7578dd` |

C2 and C3 share one commit on purpose. With `noUnusedLocals` on, a commit that only removes
`export` from a symbol nothing uses fails typecheck, so it could not be bisected through.

## Files (46 at baseline)

| Group | Count | Verdict |
|---|---|---|
| `apps/admin` orphans: `AuditResourceChip` + `lib/auditResources`, `PipelineStageChip` + `lib/pipelineStages`, `McpInstallButtons`, `ConnectProvenanceBand`, `DashboardPdcaGuide`, `FixCard`, `ReportSourceBadge`, `qa-coverage/{RunDetail,StoryCard,StoryDrawer,qaStoryTypes}`, `skeletons/{Query,Research}Skeleton`, `lib/{humanAlertsBurndown,reportStatus,staleness,useOptimisticMutation}`, `lib/statTooltips/{dashboard,integrations,reports}` | 22 | **KILL**. Each lost its last importer between April and October. `FixCard`'s 2026-10-14 Sentry link also lives in the rendered `FixDetailPanel`. The `qa-coverage` four duplicate inline copies in `QaCoveragePage.tsx` |
| The four banners the 2026-10-14 pass kept: `DashboardStatusBanner`, `InventoryStatusBanner`, `FirecrawlStatusBanner`, `SkillsReadout` | 4 | **KILL**. Their last importers left on 2026-05-20, 05-27 and 06-23. Their October edits were repo-wide sweeps, and the console rework has since landed (#490) |
| `packages/agents/src/browser/*` (5) and `src/sandbox.ts` | 6 | **KILL**. The package is private and has no `exports` map, so `@mushi-mushi/agents/browser` never resolved. `sandbox.ts` was superseded by `src/sandbox/` |
| `ConnectStepLaneReadout.tsx` | 1 | **KILL** (cascade). Its only importer was the ConnectStepFlow canvas, removed in commit 2 |
| Manual tools: `apps/admin/scripts/capture-theme-matrix.mjs`, `packages/mcp/scripts/{generate-glama-json,reinstall-cursor-mcp,verify-stdio-install}.mjs` | 4 | KEEP. Each header documents how to run it |
| Design primitives: `Jargon`, `PageHelpPanel` + `lib/pageHelpPrefs`, `PageSection`, `TabbedSubNav`, `motion/MotionOverlay` | 6 | KEEP for the design lane. `page-scaffold.ts` lists `PageSection` and `PageHelpPanel` as canonical, and the tablist lint rule names `TabbedSubNav` |
| `packages/agents/src/drift-agent.ts` | 1 | KEEP. `_shared/drift-agent.ts` calls it the canonical source to keep in sync. Deleting it needs that comment changed in a deployed edge file (BL-043) |
| `packages/plugin-jira/src/jira-webhook.ts` | 1 | KEEP, decision. A documented inbound Jira → Mushi bridge that the package never exports, so it ships to no one (BL-042) |
| `packages/react-native/src/instance.ts` | 1 | KEEP, decision. The changelog says `MushiRN.getInstance()` is exported, but nothing exports or registers it (BL-042) |
| `apps/admin/src/content/dispatch-prerequisites.mdx` | 1 | KEEP, decision. The console has no MDX loader, so this page never renders. Move it into `apps/docs` or delete it (BL-043) |

## Exports and types

| Group | Verdict |
|---|---|
| 211 exports and 184 types, plus the declarations they orphaned (about 1,850 lines) | **KILL** (commits 2 and 4) |
| 59 findings (48 exports, 11 types) in 24 design-system files | KEEP for the design lane; the list was handed over. Still counted |
| `JARGON` (`lib/copy.ts`) | KEEP. Imported by the kept `Jargon.tsx`, which knip ignores as an importer because it is itself unused |
| `updateRewardsUser` (`packages/web/src/rewards.ts`) | KEEP, **bug** (BL-040). Its JSDoc says `Mushi.identify()` calls it, but nothing does, so a user identified after init gets no rewards attribution |
| `isKeychainEnabled`, `tryDeleteKeyFromKeychain` (`packages/cli/src/keychain.ts`) | KEEP, possible bug (BL-041). No CLI path deletes a keychain entry, and `loadConfig()` prefers the keychain over the file |
| `ChartEventSchema`, `PROJECT_GROUP_COLORS` | KEEP. Only a type reads these values, and the lint rule forbids a module-private value that is used only as a type |
| `STATIC_ROUTES`, `MIGRATE_CATALOG`, `MIGRATIONS_CATALOG` | KEEP, tagged `@public`. `build-console-knowledge.mjs` loads the first through jiti, and `check-migration-catalog-sync.mjs` regexes `export const` for the other two. Knip cannot see either |
| 5 duplicate exports (`bannerEnterSpring`/`chromeEnterSpring`, `PAGE_CONTENT_STACK`/`PAGE_STACK`, `CONFIDENCE_SEGMENT_COUNT`/`confidenceSegmentCount`, `DIAGNOSIS_PLAIN`/`PRICING_LEDE`, `DocsBridgePage` named + default) | KEEP. Merging an alias means renaming its importers, which is refactor work. Two of them sit in design files (BL-044) |

The hero-snapshot publishers lost their only reader in commit 2: `usePageHeroSnapshot()` had no
consumer. About 31 pages still call `usePublishHeroSnapshot` / `usePublishPageHeroStats`, which now
write a module variable nobody reads. Removing those calls is behaviour-neutral but touches every
one of those pages, so it waits for the owner (BL-045).

## Dependencies (4 + 15 + 2 unlisted at baseline)

| Package | Dependency | Verdict |
|---|---|---|
| `apps/docs` | `@react-three/drei` | **KILL**. Named only in `transpilePackages`, which was edited too |
| `apps/docs` | `@theguild/remark-mermaid` | **KILL**. Nextra 4.6.1 declares its own copy |
| `packages/agents` | `@browserbasehq/sdk`, `@cursor/sdk`, `@mendable/firecrawl-js`, `@playwright/test` (dev) | **KILL**. Their users were the deleted browser providers. The optional `@cursor/sdk` peer stays |
| `packages/react` | `@testing-library/jest-dom` (dev) | **KILL**. No setup file or import |
| `eslint-plugin-mushi-mushi` | `@types/eslint`, `@typescript-eslint/utils` (dev) | **KILL**. ESLint 10 ships its own types; no import |
| `packages/node` | `@types/express` (dev) | **KILL**. The express adapter uses structural types and imports nothing from `express` |
| `examples/e2e-dogfood` | `msw` (dev) | **KILL**. No import, though two comments claim msw mocks GitHub (BL-043) |
| `apps/docs` | `tailwindcss` (dev) | KEEP. `globals.css` has `@import 'tailwindcss'` |
| `packages/server` | `yaml` (dev) | KEEP. `vitest.config.ts` aliases `npm:yaml@2` to it |
| `packages/svelte` | `svelte` (dev) | KEEP. It backs the `svelte >=4` peer |
| `packages/marketing-ui` | `@mushi-mushi/brand` | KEEP. Its CSS reads `--mushi-*` custom properties from brand |
| `examples/e2e-dogfood` | `@mushi-mushi/core`, `@mushi-mushi/web` (dev) | KEEP. The workspace links may be how the tests resolve the SDK build; not proven either way |
| `packages/mcp` | `@modelcontextprotocol/core` | KEEP, owner. Not imported by `src` or `dist`, and `@modelcontextprotocol/server` depends on it itself. It is a published dependency added on purpose in #380 (BL-044) |
| `examples/realworld` | `@modelcontextprotocol/sdk` (dev) | KEEP. `tests/conduit-journey.spec.ts` dynamic-imports it; knip misses the call |
| unlisted | `esbuild` in `packages/web/src/build-strip.test.ts`, `@e2b/code-interpreter` in `packages/agents` | KEEP (BL-013). Both resolve today: one through tsup, one as an optional runtime import |

## Not judged this pass

- Production mode still reports 202 exports and 28 types. Most of them are used only by tests,
  which production mode does not read. Each needs `@internal`, deletion together with its test, or
  a non-test caller (BL-044).
- C5 residue: `check:residue` ratchets it; no `.only` or `debugger` was found. C6 duplication beyond
  knip's alias findings, C7 orphan assets and C8 suppressions were not examined.
- C9 schema: not examined (human gate).

## Baseline vs after

| Metric | Before | After |
|---|---:|---:|
| knip default (error-level) | 534 | **95**, ceiling 95 (94 fails) |
| — files | 46 | 14 |
| — exports / types | 265 / 195 | 54 / 11 |
| — dependencies / devDependencies | 4 / 15 | 2 / 6 |
| — unlisted / unresolved / duplicates | 2 / 1 / 6 | 2 / 1 / 5 |
| knip production (error-level) | 702 (ceiling 705) | **282**, ceiling 282 (281 fails) |
