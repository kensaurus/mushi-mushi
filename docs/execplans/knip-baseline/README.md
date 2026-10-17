# knip baseline (Plan 017, Workstream A)

Captured 2026-09-12 on branch `fix/stagger-edge-cron-herd` with knip 6.34.0
after the A1 config pass and the A3 deletions (`PublicHomePage.tsx`,
`_unused_notifyA2A`, `generate-hosted-tools.mjs`). Nothing else knip reports
was deleted; every remaining finding is the A2 register or debt to pay down.

| Mode | Command | Error-level issues | CI threshold |
|---|---|---:|---|
| production | `pnpm exec knip --production --reporter json` | **50** | `--max-issues 50` |
| default | `pnpm exec knip --reporter json` | **38** | `--max-issues 38 --treat-config-hints-as-errors` |

> **Re-measured 2026-10-17, third round: 50 production / 38 default** (49 and 37 fail).
> With the owner's go-ahead, the exports and types that no non-test code called were judged one
> by one. Deleted with their tests: `withAbort`, `formatError` (a copy of `printAndExit`'s
> formatting that had already drifted from it), `formatUpgradeHint`, `shouldWrap`,
> `diagnosesAtSpendCap`, `reportsLinks`, the `orgPermissions` `canDeleteProject` (production uses
> the one in `project-models.ts`), `bundlerKindForFramework`, `cliSetupOnboardingPath` and
> `CLI_SETUP_QUERY`, `findSlashCommand`, `isNativeOrigin`, `describeByokTestResult`,
> `buildGuidedFallbackCommands` and its two types, `monorepoInstallGuidance`, the project-level
> `buildCursorDeeplink` / `buildVsCodeDeeplink`, and twelve explainer `*Definition` lookups plus
> the two `dashboardExplainer` helpers. The `MUSHI_TAGLINE_V2` re-export in `landing-copy.ts` was
> dropped. Where a deleted test also checked live code, the check stays against the live code: the
> explainer tests read the guide tables directly, the deeplink tests use the org-level builders
> that share the encoders, the pricing test keeps its `estimateCost` cap check, and the env-prefix
> checks call `mushiEnvVarsForBundler`. Eight helpers stayed because their tests check behaviour
> that remains (`getGlobalOutputFormat`, `isKeychainEnabled`, `isStdoutGuardInstalled`,
> `checkCliConfig`, `ALL_CONFIG_DOCS`, `RECIPE_SMALLEST_FONT_PX`, `getPreset`,
> `isNewerStableVersion`), and are tagged `@internal`. `CONFIG_DOC_GROUPS` is read by
> `scripts/generate-config-reference.mjs` through jiti, so its tag is now `@public` with that
> reason.

> **Re-measured 2026-10-17, second round: 91 production / 38 default** (90 and 37 fail).
> With the owner's go-ahead, the admin modules that only their own tests reached were deleted
> together with those tests: the Connect lane leftovers (`ConnectStepFlow.tsx`,
> `connectLaneMetadata`, `connectLaneReadout`, `connectStepLanes`, `connectExplainer`),
> `heroSnapshots/*`, `featureExplainBurndown`, `mcpConnectUx` and `lib/semver.ts`. Two cascades
> followed: `layoutHeroFromStats.ts` (only `buildHeroEnrichment` and a type, now with no caller)
> and `connectLaneOverlay` in `guideLiveOverlay.ts`. The `PageHeroSnapshot` type left with them.
> The live `heroMetricChips` case moved to `pageHeroSnapshot.test.ts`; every other case in the
> touched test files stays.

> **Re-measured 2026-10-17 (dead-code pass), knip 6.34.0: 104 production / 38 default**
> (103 and 37 fail, 104 and 38 pass; measured after `pnpm build` on branch
> `chore/housekeep-dead-code-2026-10-17`, base `origin/master` `3fc2476d`). Master itself measured
> 232 / 38; `isKeychainEnabled` gained a caller when the 2026-10-16 follow-ups merged. Production
> mode does not read tests, and 129 of its findings were exports whose implementation runs in
> production but whose export exists only so a test can reach it (125, each with a live caller in its
> own module), or declared test seams such as `resetPageUnloadingForTests` (4). Those now carry
> `@internal Exported for tests only.` No code was deleted and no package sets `stripInternal`, so
> no shipped `.d.ts` changed. `MUSHI_DOCS_INDEX` stays counted, because its file is generated in
> lock-step with the hosted `mcp` edge function. The 46 exports and 4 types still counted have no
> non-test caller anywhere. They, and the admin modules that only their own tests reach, wait for a
> delete-with-test decision (BL-042).

> **Re-measured 2026-10-16 (dead-code pass), knip 6.34.0: 232 production / 39 default**
> (231 and 38 fail, 232 and 39 pass; measured after `pnpm build` on branch
> `housekeep/2026-10-16-deadcode`). Before the pass the true counts were 702 / 534. 33 unused
> files were deleted (one of them a cascade). Unused exports and types were un-exported, along with
> the declarations that left dead, the write-only page hero snapshot store was removed, and 11
> dependencies nothing imports were dropped. The
> keep/kill table, including everything kept on purpose and still counted, is in
> [`docs/plan-dead-code-2026-10-16.md`](../../plan-dead-code-2026-10-16.md). Both JSON
> baselines and the two tables below were regenerated from this run.

> **Re-measured 2026-10-14 (housekeep pass), knip 6.34.0: 705 production / 534 default**
> (704 and 533 fail, 705 and 534 pass; measured after `pnpm build` on `origin/master` `a3224b7d`).
> Before the pass the true counts were 721 / 550, three and twenty-nine under the old ceilings. Sixteen
> `apps/admin` files that knip reports unused, that no tracked file outside these JSON baselines names,
> and that nothing has touched since 2026-09-13 were deleted. Four newer orphans
> (`DashboardStatusBanner`, `FirecrawlStatusBanner`, `InventoryStatusBanner`, `SkillsReadout`) stay
> while the console rework is in flight. Both JSON baselines were regenerated with the commands in
> the table. What remains is registered in `docs/BACKLOG.md`.

> **Re-measured 2026-09-21 (third pass), knip 6.34.0: 724 production / 579 default**
> (723 and 578 fail, 724 and 579 pass). The root workspace now marks its tooling scripts as
> production entries (`scripts/*.mjs!`, `scripts/marketing/*.mjs!`, …). Production mode only
> follows `!` entries, so before this it never walked the root scripts at all and reported the
> helpers they import (`scripts/lib/docs-stats.mjs`, `scripts/lib/sdk-version-matrix.mjs`) as
> unused files — false positives, since both have importers. Walking them surfaced 5 genuinely
> dead exports in those helpers (`buildReadmeClaimChecks`, `VERSION_MATRIX_GROUPS`,
> `collectPackageVersions`, `VERSION_MATRIX_START`, `VERSION_MATRIX_END`), each used only inside
> its own module; they are now module-local. One artifact remains and is counted, not hidden:
> `scripts/check-release-version.mjs` invokes the `changeset` binary, which comes from a
> devDependency that production mode cannot see. Putting it in `ignoreBinaries` would trade one
> counted issue for a config hint, and the default run fails on hints.

> **Re-measured 2026-09-21 on `feat/gtm-phase1-measure` (PR #394), knip 6.34.0: 725 production / 584 default**
> (724 and 583 fail, 725 and 584 pass; measured after merging master's hosted-billing commit
> `181ca882`, which removed one default-mode finding). The GTM branch first pushed the counts to 784 / 602. Nothing was
> suppressed to get back under: new module-local constants were un-exported, test-only helpers were tagged
> `@internal` (knip's documented production-mode treatment for exports used only by tests), and the docs
> entries became `content/**/_meta.ts!` and `content/**/*.mdx!`. Production mode only follows entries
> marked `!`, so before this it could not see the components the MDX pages import and reported them as unused.
> The only pre-existing file that left the list that way (`PricingTiersTable.tsx`) really is imported, by
> `pricing.mdx` and `cloud.mdx`; the others were this branch's new compare-page components. The untracked `.claude/worktrees/` checkout, which inflated the default
> count locally, is now gitignored.

> **Re-measured 2026-09-12, after all workstreams landed and after `pnpm install`.**
> The first capture read 733 / 579, taken while the SDK v2 migration and the
> admin PWA were still in flight. The true counts on the finished tree are
> **748 production / 587 default**, verified by binary search: 747 and 586 fail,
> 748 and 587 pass. The extra findings are test-only exports from the new PWA
> modules (`lib/pwa.ts`, `lib/voiceIntake.ts`, `lib/voiceRecorder.ts`,
> `components/voice/`), which production mode cannot see used because it
> excludes tests — the same category as the admin components already in the
> baseline. These are the numbers in ci.yml. Never raise them again.

`--max-issues` counts only issue types whose rule is `error`. The eight
"referenced optional peerDependencies" are reported at `warn` (see
`knip.json` → `rules`) because optional peers that are referenced are the
intended design of the plugin and react-native packages; they are visible in
the report but never count. Configuration hints are zero in both modes and
are enforced with `--treat-config-hints-as-errors` on the default run.

**Everything else the config excludes, stated plainly**, so the thresholds
cannot be read as covering more than they do:

| Exclusion | Why |
|---|---|
| `ignoreWorkspaces: ["examples/realworld/*"]` | A vendored reference app we do not own; its dead code is not ours to ratchet. |
| `packages/server` project excludes `supabase/**` | Deno source with `npm:` / `jsr:` specifiers that the oxc resolver cannot follow. Covered instead by the Deno entrypoint check. |
| `apps/docs/playground/**` | Not pnpm workspaces and have no `node_modules`. |
| `packages/create-mushi-mushi/templates/**` | Scaffolding templates, unreferenced on purpose. |
| `node: false` on `packages/server` | knip's Node plugin registered every `**/*.test.ts` in every workspace and pulled the Deno tests into the graph. |

Those are scope decisions, not suppressions: nothing inside the counted scope
is downgraded except the eight warn-level optional peers above.

Regenerate both files with the commands above (add `--no-exit-code`), then
lower the two thresholds in `.github/workflows/ci.yml` to the new totals.
Never raise them.

## Counts per workspace: production

| workspace | files | dependencies | binaries | unlisted | exports | types | duplicates | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| . | 1 |  | 1 |  |  |  |  | 2 |
| apps/admin | 11 |  |  |  | 4 | 1 | 4 | 20 |
| apps/docs |  |  |  |  |  |  | 1 | 1 |
| examples/e2e-dogfood | 1 |  |  |  |  |  |  | 1 |
| packages/adapters | 1 |  |  |  |  |  |  | 1 |
| packages/agents | 3 |  |  | 1 |  |  |  | 4 |
| packages/brand | 1 |  |  |  |  |  |  | 1 |
| packages/capacitor | 1 |  |  |  |  |  |  | 1 |
| packages/marketing-ui |  | 1 |  |  |  |  |  | 1 |
| packages/mcp | 9 | 1 |  |  | 1 |  |  | 11 |
| packages/plugin-jira | 1 |  |  |  |  |  |  | 1 |
| packages/react-native | 1 |  |  |  |  |  |  | 1 |
| packages/server | 3 | 1 |  |  |  |  |  | 4 |
| packages/verify | 1 |  |  |  |  |  |  | 1 |
| **total** | **34** | **3** | **1** | **1** | **5** | **1** | **5** | **50** |

Warn-level (not counted): optionalPeerDependencies 8 (agents 1, plugin-sdk 2,
react-native 4, wasm-classifier 1).

## Counts per workspace: default

| workspace | files | dependencies | devDependencies | unlisted | unresolved | exports | types | duplicates | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| apps/admin | 8 |  |  |  |  | 6 | 1 | 4 | 19 |
| apps/docs |  |  | 1 |  |  |  |  | 1 | 2 |
| examples/e2e-dogfood |  |  | 2 |  |  |  |  |  | 2 |
| examples/realworld |  |  | 1 |  |  |  |  |  | 1 |
| packages/agents | 1 |  |  | 1 |  |  |  |  | 2 |
| packages/cli |  |  |  |  |  | 1 |  |  | 1 |
| packages/marketing-ui |  | 1 |  |  |  |  |  |  | 1 |
| packages/mcp | 3 | 1 |  |  |  |  |  |  | 4 |
| packages/plugin-jira | 1 |  |  |  |  |  |  |  | 1 |
| packages/react-native | 1 |  |  |  |  |  |  |  | 1 |
| packages/server |  |  | 1 |  | 1 |  |  |  | 2 |
| packages/svelte |  |  | 1 |  |  |  |  |  | 1 |
| packages/web |  |  |  | 1 |  |  |  |  | 1 |
| **total** | **14** | **2** | **6** | **2** | **1** | **7** | **1** | **5** | **38** |

Warn-level (not counted): optionalPeerDependencies 8.

## Read in cascade order

> This walk-through describes the 2026-09-12 findings. For what the current
> counts contain, and why each item is kept, see the keep/kill tables in
> [`docs/plan-dead-code-2026-10-16.md`](../../plan-dead-code-2026-10-16.md).

1. **files** — the register. `packages/agents/src/**` (8, `FixOrchestrator`
   never constructed), `packages/mcp/scripts/*.mjs` (3 manual scripts with no
   package.json or docs reference), `packages/plugin-jira/src/jira-webhook.ts`,
   `packages/react-native/src/instance.ts`, the 51 admin components/libs, and
   `apps/admin/src/content/dispatch-prerequisites.mdx`. Production mode adds
   test-only helpers and every file reached only through a test entry.
2. **unresolved** — `packages/server/src/__tests__/explore-tab-navigation.test.ts`
   imports `../../apps/admin/src/lib/exploreTabNavigation.ts`, which resolves
   to `packages/server/apps/…` (does not exist). Real bug, out of Workstream A
   scope; the owning fix belongs to the server test suite.
3. **unlisted** — `packages/agents` dynamic-imports `@e2b/code-interpreter`
   without declaring it; the three `@modelcontextprotocol/sdk/client` hits in
   `packages/mcp/scripts/*.mjs` (default mode only) are transient: the MCP SDK
   migration (B4) was in flight in a sibling agent while this baseline was
   captured. Re-capture after B4 lands.
4. **dependencies / devDependencies** — mostly test-only or Deno-only usage
   (`@supabase/supabase-js`, `yaml`, `zod` in `packages/server` are read
   through `npm:` specifiers knip cannot see; `@mushi-mushi/tsconfig` in
   inventory-auth-runner is now used since its tsconfig extends it).
5. **exports / types** — 490 (default) / 620 (production) symbols exported but
   never imported. The two barrels tagged `@public`
   (`packages/core/src/index.ts`, `apps/admin/src/components/ui.tsx`) are entry
   files and never counted; the rest are candidates for the A3 exports pass.

## knip.json decisions

- `compilers.mdx: true` enables the built-in MDX import extractor (knip only
  auto-enables it when `@mdx-js/*` is a direct dependency; here Nextra brings
  it transitively). `apps/docs` lists `content/**/*.mdx!` and the Nextra
  `content/**/_meta.ts!` files as entries (the `!` makes them production
  entries too) and excludes `playground/**`, which
  has its own package.json files but is not a pnpm workspace.
- `packages/server` excludes `supabase/**` from `project` (Deno). Its
  vitest tests still import `_shared/*.ts`, so those files enter the graph;
  their `npm:hono@4` / `npm:ai@4` specifiers surface as an unlisted package
  literally named `npm`, which is what `ignoreDependencies: ["npm"]` covers.
  `node: false` disables knip's Node plugin there because the root manifest's
  `node --test` scripts make that plugin register `**/*.test.ts` in every
  workspace, pulling the Deno tests under `supabase/functions` into the graph.
  `src/__tests__/__stubs__/npm-stub.ts` is an entry because
  `vitest.config.ts` references it by path inside a custom resolver.
- `packages/web`: `ask-harness/vite.config.ts` is registered with the vite
  plugin so the Ask harness (`ask-harness/index.html` → `main.ts`) is an entry.
- `apps/admin`: `src/stubs/rrweb.ts` is an entry; `vite.config.ts` aliases
  `rrweb` to it in dev and knip does not read `resolve.alias`.
- Root (`.`) treats `scripts/**` as manually-run tooling (entries), including
  the CloudFront Function sources deployed verbatim by `deploy-admin.yml`, and
  excludes the non-JS platform trees (android, ios, flutter, cursor-plugin,
  deploy, supabase, session-artifacts, tmp).
- `packages/create-mushi-mushi/templates/**` are scaffold data, not code in
  the package graph.
- `ignoreBinaries` lists system binaries only (`rg`, `netstat`, `findstr`,
  `ffmpeg` at root; `supabase`, `icacls` in the CLI; `pod` in capacitor).
- `ignoreWorkspaces: ["examples/realworld/*"]` keeps the vendored Conduit
  fixtures out; they have their own lint story.
- `rrweb` needed no `ignoreDependencies` entry: knip resolves it through the
  apps/admin stub and the web package's `vi.mock`, so the plan's suggestion
  produced a "remove from ignoreDependencies" hint and was dropped.
