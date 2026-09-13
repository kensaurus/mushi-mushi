# knip baseline (Plan 017, Workstream A)

Captured 2026-09-12 on branch `fix/stagger-edge-cron-herd` with knip 6.34.0
after the A1 config pass and the A3 deletions (`PublicHomePage.tsx`,
`_unused_notifyA2A`, `generate-hosted-tools.mjs`). Nothing else knip reports
was deleted; every remaining finding is the A2 register or debt to pay down.

| Mode | Command | Error-level issues | CI threshold |
|---|---|---:|---|
| production | `pnpm exec knip --production --reporter json` | **748** | `--max-issues 748` |
| default | `pnpm exec knip --reporter json` | **587** | `--max-issues 587 --treat-config-hints-as-errors` |

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

| workspace | files | dependencies | unlisted | exports | types | duplicates | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| . | 3 |  |  |  |  |  | 3 |
| apps/admin | 64 |  |  | 295 | 160 | 5 | 524 |
| apps/docs | 1 | 2 |  | 34 | 9 | 1 | 47 |
| examples/e2e-dogfood | 1 |  |  |  |  |  | 1 |
| packages/adapters | 1 |  |  |  |  |  | 1 |
| packages/agents | 8 |  | 1 | 3 | 2 |  | 14 |
| packages/brand | 1 |  |  |  |  |  | 1 |
| packages/capacitor | 1 |  |  |  |  |  | 1 |
| packages/cli |  |  |  | 46 | 16 |  | 62 |
| packages/core |  |  |  | 4 | 4 |  | 8 |
| packages/marketing-ui |  | 1 |  | 1 |  |  | 2 |
| packages/mcp | 9 | 1 |  | 5 |  |  | 15 |
| packages/mcp-ci |  |  |  | 3 |  |  | 3 |
| packages/node |  |  |  | 1 | 2 |  | 3 |
| packages/plugin-jira | 1 |  |  |  |  |  | 1 |
| packages/react-native | 1 |  |  | 3 | 2 |  | 6 |
| packages/server | 2 | 1 |  |  |  |  | 3 |
| packages/verify | 1 |  |  |  |  |  | 1 |
| packages/wasm-classifier |  |  |  |  | 1 |  | 1 |
| packages/web |  |  |  | 39 | 12 |  | 51 |
| **total** | **94** | **5** | **1** | **434** | **208** | **6** | **748** |

Warn-level (not counted): optionalPeerDependencies 8 (agents 1, plugin-sdk 2,
react-native 4, wasm-classifier 1).

## Counts per workspace: default

| workspace | files | dependencies | devDependencies | unlisted | unresolved | exports | types | duplicates | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| . |  |  |  |  |  | 5 |  |  | 5 |
| apps/admin | 51 |  |  |  |  | 218 | 160 | 5 | 434 |
| apps/docs |  | 2 | 1 |  |  | 14 | 7 | 1 | 25 |
| examples/e2e-dogfood |  |  | 3 |  |  | 2 |  |  | 5 |
| examples/realworld |  |  | 1 |  |  |  |  |  | 1 |
| packages/adapters |  |  |  |  |  | 1 |  |  | 1 |
| packages/agents | 8 |  | 7 | 1 |  | 2 | 1 |  | 19 |
| packages/cli |  |  |  |  |  | 17 | 8 |  | 25 |
| packages/core |  |  |  |  |  | 1 | 4 |  | 5 |
| packages/eslint-plugin-mushi-mushi |  |  | 2 |  |  |  |  |  | 2 |
| packages/marketing-ui |  | 1 |  |  |  | 1 |  |  | 2 |
| packages/mcp | 3 | 1 |  |  |  | 1 |  |  | 5 |
| packages/mcp-ci |  |  |  |  |  | 1 |  |  | 1 |
| packages/node |  |  | 1 |  |  | 1 |  |  | 2 |
| packages/plugin-jira | 1 |  |  |  |  |  |  |  | 1 |
| packages/react |  |  | 1 |  |  |  |  |  | 1 |
| packages/react-native | 1 |  |  |  |  | 2 | 2 |  | 5 |
| packages/server |  |  | 2 |  | 1 |  |  |  | 3 |
| packages/svelte |  |  | 1 |  |  |  |  |  | 1 |
| packages/wasm-classifier |  |  |  |  |  |  | 1 |  | 1 |
| packages/web |  |  |  |  |  | 32 | 11 |  | 43 |
| **total** | **64** | **4** | **19** | **1** | **1** | **298** | **194** | **6** | **587** |

Warn-level (not counted): optionalPeerDependencies 8.

## Read in cascade order

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
5. **exports / types** — 480 (default) / 626 (production) symbols exported but
   never imported. The two barrels tagged `@public`
   (`packages/core/src/index.ts`, `apps/admin/src/components/ui.tsx`) are entry
   files and never counted; the rest are candidates for the A3 exports pass.

## knip.json decisions

- `compilers.mdx: true` enables the built-in MDX import extractor (knip only
  auto-enables it when `@mdx-js/*` is a direct dependency; here Nextra brings
  it transitively). `apps/docs` lists `content/**/*.mdx` and the Nextra
  `content/**/_meta.ts` files as entries and excludes `playground/**`, which
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
