# App Recipe Control Plane — one page per app showing what it is made of, where it drifted, and a reviewed PR to fix it

> Status: `PLANNED` (design spec, no code yet). Researched and audited 2026-10-02.
> Registered as Plan 019 in [PLANS.md](./PLANS.md). Decision record: [ADR 0016](../adr/0016-mushi-as-the-app-recipe-control-plane.md) (Accepted, owner-delegated, 2026-10-02: Phases 1, 1b and P1 now; the sequencing gate for Phases 2, P2 and 3 was struck by the owner on 2026-10-02, [ADR 0017](../adr/0017-strike-the-plan-019-020-sequencing-gate.md)).
> Scope: `packages/server` (api, `_shared`, connectors, two new functions, migrations), `apps/admin` (the Recipe and Portfolio pages), `packages/mcp`, `packages/cli`, and glot.it as the pilot host.
> Related: **Plan 020 (in progress)**, the broader portfolio-operator research (GTM, analytics, marketing, cross-app notifications, sign-up funnels), being written separately at [portfolio-operator.md](./portfolio-operator.md). This plan owns the recipe data model, the connector interface and the portfolio rollup of recipes. Plan 020 builds on them and does not redefine them.

## Goal

Each project gets an **App Recipe**: the schema, design system, routes and stories, gates, CI/CD, build and deploy targets, required env vars (names only) and integrations. All of it is on one visual page in the console. For each element the page shows three things:

- where the data came from;
- whether reality has drifted from what the app declares;
- a reviewed draft PR that brings it back.

The recipe is also handed to the diagnosis and to the coding agent, so a fix respects the app's own tokens and schema.

**Portfolio-native from day one.** One person often ships several apps, sites, services and libraries: the owner's own organization holds 7 projects. An **organization is the portfolio**. Every recipe row carries `organization_id`. Shared things (an auth provider, a Supabase project, a Stripe account, a domain, a Slack channel, a push key) are first-class *resources* that several projects *use*. Rolling recipes up to the portfolio is a query over existing rows, not a second data model. The portfolio surfaces cross-project concerns:

- one auth provider configured differently across apps;
- shared credits and billing;
- broken cross-app deep links;
- shared notification channels;
- SDK version skew;
- CI cost per repo;
- the same misconfiguration repeated across repos, fixed once with one draft PR per repo.

**Pluggable.** Every source feeds a recipe through one **connector** interface (§2b), with four capabilities: snapshot, detect drift, propose a change as a PR, and act through an API only with approval. GitHub, Supabase, Vercel, Expo/EAS, App Store Connect, Play Console, Stripe, Sentry and PostHog are connectors. So are a signed generic HTTP connector, a webhook push, OpenTelemetry and CSV, which together cover legacy systems.

**Positioning check** (VISION/AGENTS drift test, ADR 0016): every element below names the diagnosis or fix it improves. An element that cannot name one is Advanced-mode only (CI minutes and cost). Every element is optional and renders "not connected" with no setup. No element requires a monitoring stack or a hosting provider.

## Success criteria

1. **The Recipe page lights up from data Mushi already has.** Phase 1 ships with no migration. On glot.it it shows all 8 elements, each in one of five states: `ok`, `drift`, `unknown`, `not_connected` or `error`.
2. **"Never checked" can never render as green.** The 5th silent fail-open is the failure mode to avoid.
   - Today `backend_schema_snapshots` has 0 rows, and every `sdk_upgrade_jobs.deploy_status` is `unknown`.
   - Those elements must render as `not_connected` and `unknown`, with a reason, not as `ok`.
   - Unit tests cover every unknown path of `deriveElementState()`.
3. **glot.it's new design system is authored in the recipe format from its first commit, and ingested then too** (Phase 1b, outside the ADR 0016 gate).
   - It uses W3C DTCG 2025.10 tokens referenced from `mushi.recipe.json` (Appendix B).
   - Mushi ingests it, shows it, and flags off-token literals.
4. **One real recipe change lands as a draft PR on glot.it.**
   - The change is a token edit or a budget edit.
   - The PR stays in draft and touches only allowlisted paths.
   - The owner merges it by hand.
5. **The recipe improves a real diagnosis.**
   - `get_fix_context` returns a `recipe` excerpt: the relevant tokens, the touched tables, and whether the last fix has deployed.
   - At least one dogfood fix PR uses on-token values where the pre-recipe baseline used literals. The evidence is a PR diff.
6. **The portfolio lights up from existing data** (Phase P1, no migrations).
   - `/portfolio` for the owner's 7-project organization shows one card per project with its worst recipe state.
   - It also shows the Mushi SDK version skew across apps (`sdk_versions` vs each project's observed SDK version) and every `gate_findings.rule_id` open in at least 2 projects, as a "fix once" list.
7. **One connector contract, three implementations, one contract test suite.**
   - GitHub and Supabase are refactored from existing code. The generic signed HTTP connector covers legacy systems.
   - All three pass the same contract tests: snapshot schema, a failing probe → `error` state (never `ok`), and no write without a capability plus an approval.

---

## Part B — what exists today (internal audit, 2026-10-02)

### B1. Corrected assumptions

These assumptions came from the brief, from AGENTS.md, or from what the code appears to promise. The repo and the live database contradict them, and the plan is built on the corrected facts. Quotation marks mean the words appear in the brief.

| Assumption | Actually (evidence) |
|---|---|
| "inventory_nodes" (the brief; also AGENTS.md's `inventory-crawler` row) | No such table. Inventory and story nodes live in `graph_nodes`. `node_type` ∈ `action, api_dep, app, component, element, page, page_v2, report_group, user_story`. Raw YAML is in `inventories` (`raw_yaml`, `parsed`, `is_current`). |
| backend-drift-scanner "already snapshots schemas" | It is built (`functions/backend-drift-scanner/index.ts:2-18`; insert at `:115`; gate run at `:128`), but **it has never scanned anything**. `backend_schema_snapshots` has 0 rows, and 0 projects set `project_settings.supabase_project_ref`, which is the scanner's only selector (`:218`). It also needs a Supabase PAT under the BYOK `supabase` provider (`migrations/20260611150000_byok_supabase_provider.sql`). |
| Integrations in `project_integrations` | That table has 0 rows. Configuration lives in `project_settings` columns (`sentry_org_slug`, `sentry_dsn`, `slack_channel_id`, `slack_bot_token_ref`, `linear_api_key_ref`, `linear_access_token_ref`, …). Health is in `integration_health_history`, written by `integration-health-probe/index.ts:291`. |
| Deploy status is known | It is not. All 50 `sdk_upgrade_jobs` rows have `deploy_status = unknown`. The only deploy signal is the GitHub Deployments API (`_shared/github.ts:434` `fetchLatestDeploymentStatusForSha`). glot.it deploys with `aws s3 sync` to S3/CloudFront, which creates no Deployment, so the lookup never matches. glot does publish `out/version.json` = `{version, buildDate, commit}` (glot `.github/workflows/deploy.yml:141`). That file is the deploy truth to use. |
| The GitHub App gives push access | `project_repos.github_app_installation_id` is null on all 7 rows. Every connected project uses a vault-referenced token (`github_installation_token_ref` / `github_user_token_ref`), resolved by `resolveProjectGithubToken` (`_shared/github.ts:85`). The token's scope belongs to the user, not to Mushi. |
| CI minutes can be read from GitHub | GitHub closed the per-workflow and per-run usage endpoints ([changelog 2025-02-02](https://github.blog/changelog/2025-02-02-actions-get-workflow-usage-and-get-workflow-run-usage-endpoints-closing-down)) and the product billing APIs ([2025-09-25](https://github.blog/changelog/2025-09-25-product-specific-billing-apis-are-closing-down)). Minutes have to be **estimated** from job durations. |
| The codebase index can see config files | `project_codebase_files` indexes code symbols only. For glot.it (1,817 rows), no `.github/workflows/*`, `*.json` or CSS files are indexed; only `capacitor.config.ts`. Recipe collectors must read files through the GitHub Contents API at a pinned SHA, as `sdk-upgrade-worker` already does. |
| Story-mapper data exists | `story_map_runs`, `synthetic_runs` and `project_codebase_graph` each have 0 rows. |

### B2. Production data per project (read-only SQL, `dxptnwrhwsqckaftyymj`, 2026-10-02)

| Project | Repos | GitHub token | `graph_nodes` | Gate runs | Metrics | Upgrade jobs | Releases | Sentry | Slack | Reports |
|---|---|---|---|---|---|---|---|---|---|---|
| **glot.it** | 1 | yes | 184 | 53 | 219 | 17 | 3 | yes | yes | 2 |
| solo-boss-cloud | 2 | yes | 210 | 0 | 0 | 7 | 0 | yes | – | 1 |
| Help Her Take Photo | 1 | yes | 32 | 0 | 0 | 6 | 0 | – | – | 9 |
| yen-yen | 1 | yes | 37 | 0 | 5 | 6 | 0 | – | yes | 0 |
| mushi-mushi | 1 | yes | 25 | 2 | 0 | 7 | 3 | yes | – | 1 |
| the-wanting-mind | 0 | yes | 15 | 0 | 0 | 7 | 0 | – | yes | 2 |
| tsumagoi | 1 | yes | 6 | 0 | 0 | 0 | 0 | – | – | 2 |

Five other projects have no repo and almost no data. Gate runs by gate: `code_health` 50, `api_contract` 2, `status_claim` 2, `crawl` 1. Metric families: `bundle.web`, `bundle.mobile`, `code_health.max_file_loc`, `code_health.god_file_count`, `error_rate.*`.

`integration_health_history` holds 328,059 rows (2026-04-17 → today). That is a retention follow-up and is out of scope here.

**glot.it is the pilot.** It is the only project with data in every element except schema, design and deploy.

### B3. Machinery to reuse

| Need | Existing piece |
|---|---|
| Reviewed PR | `createPrFromFiles` (`_shared/github-pr.ts:258`). It opens a draft, then **always** calls `markPullRequestReady` (`:349`), which triggers the host's paid CI. Dedupe with `findOpenPrByHeadPrefix` (`:404`). |
| Job model and worker | `sdk_upgrade_jobs` (`migrations/20260615232827_sdk_upgrade_jobs.sql`; active-unique in `20260618140727_…`; stuck reaper in `20260828100000_…`). Route `api/routes/sdk-upgrade.ts:66`. Runner `_shared/sdk-upgrade-runner.ts:306`. Pure planner with guards in `_shared/sdk-upgrade-plan.ts:70` (`computeBumpPlan`; registry specifiers only, `:58`). Console hook `apps/admin/src/lib/useSdkUpgrade.ts` (POST → SSE). |
| CI signals | `ci-sync` writes `fix_attempts.check_run_*` (`functions/ci-sync/index.ts:137`). Helpers: `fetchLatestCheckRun` (`_shared/github.ts:325`), `fetchLatestWorkflowRunForSha` (`:389`, used at `api/routes/sdk-upgrade.ts:503`), `normalizeDeployStatus` (`:482`). |
| Env presence | `GET /v1/admin/projects/:id/sdk-diagnostics` (`api/routes/project-ci-secrets.ts:332`). Name listing: `listRepoSecretNames` (`:162`), `listRepoVariableNames` (`:171`). Per-stack required maps (`:46`). Guided `gh secret set` fallback. Console: `apps/admin/src/lib/sdkCiSecrets.ts`, `SdkNativeConnectivityCard`. |
| Gates and metrics | `gate_runs.gate` CHECK, live: `dead_handler, mock_leak, api_contract, crawl, status_claim, spec_drift, orphan_endpoint, unknown_call, schema_drift, code_health`. Ingest `POST /v1/ingest/metrics` (`api/routes/public.ts:1711`). Reads: `GET /v1/admin/code-health` (`api/routes/code-health.ts:185`), `/stats` (`:90`). |
| Inventory | `GET /v1/admin/inventory/:projectId` (`api/routes/inventory.ts:398`), `/diff` (`:618`), `/findings` (`:667`), `/discovery` (`:1033`). `inventory-crawler` writes `gate_runs` (`functions/inventory-crawler/index.ts:277`). `story-mapper` writes `inventory_proposals` (`functions/story-mapper/index.ts:334`). |
| Integrations | `GET /v1/admin/integrations` (`api/routes/integrations.ts:21`), `/v1/admin/integrations/health` (`api/routes/health.ts:39`), `/platform` (`integrations.ts:363`). |
| Untrusted text | Two secret scanners: `skill-sync/index.ts:67-76` (`containsSecretPattern`) and `api/routes/sdk-assistant.ts:137-148` (`scanForSecrets`). The recipe is the third user, so both get extracted into `_shared/secret-scan.ts` (the repo's three-uses rule). MCP output wrapping: `functions/mcp/wrap-untrusted.ts`. |
| Graph UI | `@xyflow/react` ^12.11.1 and `d3-force` (`apps/admin/package.json`). Fixed-layout flows: `components/pdca-flow/PdcaFlow.tsx` + `pdcaFlow.data.ts`, `components/fixes/FixAttemptFlow.tsx`, `components/flow-primitives/FlowCanvasBackground.tsx`. Force graph: `components/graph/GraphCanvas.tsx` + `GraphSidePanel`. Explore: `components/explore/ExploreCanvas.tsx`. |
| Console IA | Routes in `apps/admin/src/App.tsx` (e.g. `/code-health` at `:383`). Nav in `apps/admin/src/lib/navRegistry.ts` (`NAV_REGISTRY` at `:198`; the `/code-health` entry is at `:525` with `sectionId: 'check'`; Quick-mode groups `quick-setup` / `quick-loop` / `quick-tools` sit just above). |
| MCP | `packages/mcp/src/catalog.ts` (`get_inventory` `:171`, `diff_inventory` `:180`, `list_gate_findings` `:189`, whose gate enum must grow). The tool count is pinned by `pnpm check:catalog-sync`. |
| Tokens precedent | Mushi's own brand: `packages/brand/tokens/brand.tokens.json` (DTCG, `$schema` 2025.10) → `editorial.css` through a hand-rolled generator, guarded by `scripts/check-brand-tokens-fresh.mjs`. glot.it: `packages/design-tokens/dtcg/tokens.json`, generated **from** TypeScript by `scripts/export-dtcg-tokens.mjs` (`tokens:dtcg:check`). |

### B4. What the portfolio and connectors can build on

| Need | Existing piece (live SQL / grep, 2026-10-02) |
|---|---|
| Portfolio unit | `organizations` (12 rows) and `organization_members` (`organization_id, user_id, role, …`). All 12 projects have a non-null `projects.organization_id`; project counts per organization are 7, 1, 1, 1, 1, 1. The 7-project organization is glot.it, solo-boss-cloud, yen-yen, the-wanting-mind, Help Her Take Photo, tsumagoi and mushi-demo; the mushi-mushi project is in its own organization. There is **no `projects.kind`** (app / site / service / library). |
| Per-project SDK version | `project_sdk_observations.sdk_version` per `sdk_package`. 6 of the 7 projects have one: web 1.28–1.29 and react-native 0.21.0. mushi-demo has none, so it renders `unknown`. `reports.sdk_version` covers only 4 projects, and `sdk_upgrade_jobs.verified_sdk_version` is null everywhere. Skew is compared **per package** against `sdk_versions`, never across packages. |
| Security findings today | None. Live `gate_findings.rule_id` values are `god_file`, `crawl-*`, `api-contract-mismatch` and `status-claim-violation`. `schema_drift` has never run. |
| Org-level integration defaults | `organization_integration_settings` (Sentry, Langfuse, GitHub, Cursor, Claude, Linear refs per organization), with **0 rows**. Every live integration is configured per project in `project_settings`. |
| Portfolio-wide API access | Account-level keys already exist: `project_api_keys.is_org_scoped` with `project_id = NULL`, minted by `POST /v1/admin/mcp/mint-org-key` (`api/routes/mcp-admin.ts:584`; migration `20260617013908_mcp_org_scoped_keys.sql`). They resolve to **all projects owned by `owner_user_id`** (`_shared/auth.ts:36`), not to an organization's projects. Portfolio MCP must intersect this with `organization_members` (§3b). |
| Edge-adapter pattern | `CloudAgentAdapter` (`_shared/agent-adapters.ts:185`: `kind`, `dispatch`, `poll`), behind one registry, where an unknown kind is a 400 (ADR 0013). Similar: `StorageAdapter` (`_shared/storage.ts:69`), `VendorAdapter` (`_shared/fine-tune-vendor.ts:48`). |
| Inbound event adapters | `@mushi-mushi/adapters`: Sentry, Bugsnag, Rollbar, Crashlytics, Firebase Analytics, CloudWatch, Datadog → reports. Event-shaped, not snapshot-shaped. |
| Signed HTTP protocol | `@mushi-mushi/plugin-sdk` (`signPayload` `src/sign.ts:60`, `t=<ms>,v1=<hex>`; `verifySignature` `:41`; Standard Webhooks `:86`; retry, handler). The generic HTTP connector reuses it in the opposite direction: Mushi signs, the host verifies. |
| Read-only Supabase | `_shared/supabase-mcp-client.ts` always calls the hosted MCP with `read_only=true` (`:8`, `:74`); it also has `listTables` `:201`, `listFunctions` `:236`, `getSupabaseAdvisors` `:133` and `resolveSupabasePat` `:149`. |
| OTel ingest | `POST /v1/ingest/spans` (AGENTS.md, SDK ingest). |

---

## The decisions

1. **One recipe per project.** A `mushi.recipe.json` manifest at the repo root *points at* the app's real sources of truth (token files, migrations folder, inventory, workflows) and declares intent (targets, required env names, budgets, writable paths). It never duplicates them. A repo with no manifest still gets a **derived** recipe from what Mushi observes.
2. **DTCG 2025.10 is the token format.** Mushi defines no format of its own.
   - Mushi metadata goes under `$extensions["us.kensaur.mushi"]`.
   - The ingester accepts the pre-2025.10 shorthand that both Mushi's and glot's files use today (hex strings, `"16px"`) and also glot's flat dotted keys (`"color.bg"`). The spec forbids `.` in names.
   - It normalizes all of these to 2025.10 objects and emits an `info` finding for each non-conformance.
3. **Every element has the same contract:** `source → snapshot → drift findings → change path`. Drift lands in `gate_findings` under four new gate names (`design_drift`, `ci_drift`, `deploy_drift`, `env_drift`). The existing `schema_drift`, `code_health`, `crawl` and the inventory gates are reused.
4. **Five render states, computed in one pure function.** The states are `ok | drift | unknown | not_connected | error`. "No snapshot", "probe never ran" and "older than cadence" are `unknown`, never `ok`.
5. **Changes go only through draft PRs, which stay in draft.** `createPrFromFiles` gains `markReady?: boolean` (default `true`, so `fix-worker` and `sdk-upgrade-worker` behave as before). Recipe PRs pass `false`, so a recipe edit never burns the host's CI minutes until the owner chooses to run it.
6. **What a recipe PR may write.**
   - **Never, permanently:** secret values, and DDL executed against a live database.
   - **Not in v1; later opt-ins for the owner to decide:**
     - `.github/**`, which needs the `workflow` token scope and is off by default per project;
     - new files under the declared `migrationsDir`, which is an ordinary file write that the owner applies.
   - **Never edited by Mushi:** generated token exports (`role: "export"`); the source file is edited instead.

   In v1, CI/CD, schema and env are detect-and-suggest: the console shows the patch or command, and the coding agent applies it from the editor through MCP.
7. **Collectors run in Mushi's edge functions, scans run in the host's CI.**
   - Two collectors run on Mushi's side: reading files and probes at a pinned SHA, and listing runs. They run daily and on demand.
   - Whole-repo scans (off-token literals, knip) run in the host's **existing** CI job as one extra step (ci-cost rule 3). They push results through the existing ingest pattern.
   - Mushi never clones a repo.
8. **Deploy truth comes from the target itself.**
   - Web: a declared version probe URL (glot's `version.json`).
   - Hosted platforms: GitHub Deployments where the host already creates them (Vercel and Netlify do).
   - Mobile: SDK heartbeats (`reports.environment.app_version`, `project_sdk_observations`).
   - No App Store Connect, Play or EAS credentials in v1.
9. **The Recipe page is one route, `/recipe`.** It is a fixed-layout React Flow canvas (*Sources → Build → Deploy → Runtime*) with a list fallback. Quick mode reaches it from "More tools"; Advanced mode has it under **Check**. It never appears on a public surface.
10. **The recipe feeds the diagnosis.** `get_fix_context` and the `fix-worker` prompt get a capped recipe excerpt. The excerpt is the strongest answer to the drift test. It ships with tokens in Phase 1b and gains schema and deploy state in Phase 2, not "later".
11. **The organization is the portfolio; resources are shared nodes.**
    - Recipe snapshots carry `organization_id`.
    - `projects.kind` is added.
    - Things several projects share (an auth provider, a Supabase project, a Stripe account, domains, deep-link domains, bundle IDs, push keys, Slack channels, PostHog/Sentry projects, repos) become `portfolio_resources`, which projects *use*.
    - Cross-project concerns are rules over resources and over findings grouped by `rule_id`. There is no second recipe model.
12. **One connector interface, modelled on `CloudAgentAdapter`.**
    - Each connector is an edge adapter in `_shared/connectors/` behind a registry. An unknown kind is a 400.
    - It declares its capabilities (`snapshot`, `drift`, `propose`, `act`) and the scopes each capability needs.
    - No vendor code from third parties runs on Mushi's edge. Out-of-tree and legacy systems plug in through the signed **HTTP connector protocol** or through push ingest (webhook, OTel, CSV).
13. **Least privilege, read by default, act only with approval.**
    - Credentials live in Supabase Vault as refs (`vault_store_secret`), at organization or project level.
    - Read and write credentials are separate refs, and the write ref is empty unless a capability that needs it is enabled.
    - A probe at connect time records the scopes actually granted. A capability whose scopes are missing renders `not_connected` with the missing scope named.
    - Every `act` call (an API mutation such as promoting a Play track or rolling back an EAS update) needs a `connector_actions` row approved by a human. No `act` capability ships enabled in v1.

---

## 1. The recipe, element by element

Every element is optional. **State without data:** `not_connected` if nothing is configured, `unknown` if it is configured but nothing has been observed yet.

### 1.1 Data, backend and auth

| | |
|---|---|
| **Auth and sign-ups** (Phase 2, Supabase connector) | Reads auth *configuration* only: enabled providers, email-confirmation setting, the redirect-URL allowlist, and the site URL. Sign-ups are read as an aggregate daily count (`count(*)` over `auth.users.created_at` through the read-only MCP) and **never as user rows**. Drift: `auth_redirect_missing` (a declared app domain or deep-link scheme is missing from the redirect allowlist, which breaks login inside the app); `signups_stalled` (0 sign-ups for 48 h after a deploy that previously had them; `warn`). Portfolio: the provider is a shared `auth_provider` resource, and apps on one provider with different settings raise `auth_config_divergent`. |
| **Diagnosis value** | "This broke because `profiles.locale` was dropped on Tuesday" / "the migration is in the repo but was never applied". This second case is the most common vibe-coder full-stack failure: the API returns 404 and it looks like a UI bug. |
| **Source (exists)** | `backend-drift-scanner` → `backend_schema_snapshots` (`schema_json`, `schema_hash`, `diff_summary`). Requires `project_settings.supabase_project_ref` plus a BYOK Supabase PAT. Never run in production (B1). |
| **Source (new)** | (a) A *declared* migration list: filenames under `recipe.data.migrationsDir`, read through the Contents API. (b) An *applied* list: `supabase_migrations.schema_migrations` read through the same read-only MCP the scanner already uses. (c) Non-Supabase hosts can POST a schema hash plus table list via `POST /v1/ingest/recipe` from their CI. |
| **Drift** | Existing `schema_drift` rules (dropped column, missing RLS, table change). New rule IDs `migration_unapplied` (declared, not applied; `error`) and `migration_unknown_remote` (applied, not in the repo; `warn`). |
| **Change path** | v1: suggest only. The console shows the missing filenames plus the exact `supabase db push` / `apply_migration` command, and `get_fix_context` carries it to the agent. Later opt-in: a draft PR that adds a migration *file* under `migrationsDir`. Mushi never runs DDL itself. |
| **Phase** | 1: show the snapshot, or `not_connected` plus a "link your Supabase project" CTA. 2: declared-vs-applied. |

### 1.2 Design system

| | |
|---|---|
| **Diagnosis value** | "This button uses `#E8387F` inline; your CTA token is `{color.action.primary}`" — and the fix the agent writes uses tokens, not literals. |
| **Source (new)** | `recipe.design.tokens[]`: DTCG files with `role: "source"` (hand-authored) or `"export"` (generated). Optional `recipe.design.css[]`, statically parsed for custom properties in `:root { --x: … }`, Tailwind v4 `@theme { … }`, and any selector named in the entry's `scopes[]`, e.g. `html:root[data-direction="pha-khram"]` for a design layer limited to migrated surfaces. Custom properties found only under an *undeclared* selector produce an `info` finding (`css_vars_in_undeclared_scope`), never silence. **Mushi never executes `tailwind.config.*` or any host code.** The component inventory is `recipe.design.components.globs` matched against `project_codebase_files.symbol_name` (exported components are already indexed). |
| **Snapshot** | Normalized token tree plus `tokens_hash` in `app_recipe_snapshots` (§5). |
| **Drift (`design_drift`)** | `token_nonconformant` (info: legacy shorthand, a dotted name, an unresolved alias); `token_changed` (info, the per-commit changelog); `off_token_literal` (warn: hex, rgb or px literals in declared globs that match no token, pushed from host CI by `mushi recipe check`); `component_unlisted` (info: a component exported outside the declared primitives). |
| **Change path** | Phase 3: edit a token in the console → a draft PR that changes **only** the `role: "source"` file. If the only token file is `role: "export"` (glot today), editing is disabled with the reason "this file is generated from `<generator>`; edit the source". |

### 1.3 Routes and user stories

| | |
|---|---|
| **Diagnosis value** | A report on `/practice` maps to a story and an action node, so blast radius and repro steps come from the app's declared flows. |
| **Source (exists)** | `inventories` (current YAML), `graph_nodes`, `discovery_observed_inventory` (routes observed by the SDK), inventory gates, `story_map_runs` (empty). Routes are at `api/routes/inventory.ts:398/:618/:667/:1033`. |
| **Drift** | Existing: `crawl-missing-in-app`, `api-contract-mismatch`, `status-claim-violation`, dead handler, mock leak. Declared-vs-observed comes from the existing `/discovery` diff. |
| **Change path** | Existing proposals (`inventory_proposals`). Phase 3 adds "accept → draft PR editing `inventory.yaml`" through the same worker. |
| **Phase** | 1 (read-only reuse). |

### 1.4 Gates

| | |
|---|---|
| **Diagnosis value** | "The bundle crossed your 900 KB budget in the release where this report started." |
| **Source (exists)** | `gate_runs`, `gate_findings`, `metric_series` (`bundle.*`, `code_health.*`), plus the ingest route. Knip and size budgets are not ingested today. |
| **Source (new)** | `recipe.gates.budgets` (metric name → limit) and `recipe.gates.cadence` (ISO duration per gate). The host CI pushes `code_health.knip_issues` through the **existing** `/v1/ingest/metrics`, so no new route is needed. |
| **Drift** | `budget_exceeded` (under `code_health`). `gate_stale` → the element state becomes `unknown` when the last run is older than its cadence. |
| **Change path** | Phase 3: edit a budget → a draft PR to `mushi.recipe.json`. |
| **Phase** | 1: last run and open findings per gate. 2: budgets and cadence. |

### 1.5 CI/CD

| | |
|---|---|
| **Diagnosis value** | "The fix is merged but CI on `main` has failed 4 times since, so it never deployed." Minutes and cost are Advanced-mode only (ADR 0016). |
| **Source (exists)** | `fix_attempts.check_run_*` (ci-sync), `sdk_upgrade_jobs.check_run_*` (sdk-release-sync), `fetchLatestWorkflowRunForSha`. |
| **Source (new)** | The `recipe-collector` (a) lists `.github/workflows/*.yml` through the Contents API and statically parses triggers, `concurrency`, `timeout-minutes`, `runs-on` and artifact `retention-days`; (b) lists runs since the last cursor (`GET /repos/{o}/{r}/actions/runs`) and their jobs. Results go to `ci_workflow_runs` (§5). |
| **Minutes** | Estimated: Σ jobs `ceil((completed_at − started_at)/60 s)`, minimum 1 per job, × the runner multiplier (Linux 1, Windows 2, macOS 10). Always labelled "estimated", because GitHub closed the usage APIs (B1). |
| **Drift (`ci_drift`)** | `workflow_no_concurrency`, `workflow_no_timeout`, `macos_unconditional`, `artifact_retention_gt_14`, `cron_more_than_daily` (the owner's ci-cost rules, generalized); `default_branch_red` (N consecutive failures); `minutes_spike` (> 2× the 4-week median, Advanced). |
| **Change path** | v1: suggest only. The console shows a suggested patch, and `get_fix_context` / `get_recipe_drift` hand it to the agent. Later opt-in: a draft PR editing `.github/workflows/**`. It is enabled per project, off by default, and needs the `workflow` scope on the user's token; the console says so before enabling. |
| **Phase** | 1: the latest default-branch run through `fetchLatestWorkflowRunForSha`, live and cached for 5 minutes. 2: the collector, the table and the rules. |

### 1.6 Build and deploy

| | |
|---|---|
| **Diagnosis value** | "Your fix for this report merged 2 days ago but production is still on `a1b2c3d`" — the report can say *Fixed, not yet live*. Also "web is on 1.42, Android users are on 1.39". |
| **Source (exists)** | `releases`; `sdk_upgrade_jobs.deploy_*` (all `unknown`); `reports.environment->>'app_version'` and `->>'platform'`; `project_sdk_observations`; `sdk_versions` (Mushi SDK freshness). |
| **Source (new)** | `recipe.deploy.targets[]` (Appendix B). Each target is probed by kind: `version_json` (an HTTP GET of the declared URL, no credentials, parsed for `version` / `commit`); `github_deployments` (the existing helper, for Vercel / Netlify / Pages); `sdk_heartbeat` (mobile: the newest `app_version` seen in 7 days per platform). Results go to `deploy_observations`. |
| **Drift (`deploy_drift`)** | `not_deployed` (default-branch HEAD ≠ the deployed commit for more than `maxLagHours`, default 24); `probe_failed`; `platform_skew` (web vs mobile major/minor gap above the declared limit). |
| **Change path** | None. Mushi never triggers deploys. |
| **Non-goal (v1)** | App Store Connect, Google Play Developer and EAS API keys. They carry high privilege and are per-host; heartbeats cover "what users actually run". |
| **Phase** | 1: releases plus the heartbeat version spread, and deploy shown honestly as `unknown — no deploy signal`. 2: targets and probes. |

### 1.7 Env (names only, never values)

| | |
|---|---|
| **Diagnosis value** | "`NEXT_PUBLIC_MUSHI_API_KEY` is missing from the Android build's CI secrets, so the widget is silently off in the store app." This failure class is already real (AGENTS.md, native CI secrets). |
| **Source (exists)** | `sdk-diagnostics` (repo Actions secret and variable *names* vs the required Mushi vars). |
| **Source (new)** | `recipe.env.required[]` `{name, in: ["github-actions" \| "github-environment:<env>" \| "runtime"], environments}`. GitHub environment-scoped secret names are listed through the environments API. `.env.example` (if declared) is a second declared list. The handler logic moves out of the route into `_shared/sdk-diagnostics.ts` so the recipe route and the existing route share it. |
| **Drift (`env_drift`)** | `env_missing` (declared, absent where declared; `error`); `env_undeclared` (present, not declared; `info`); `env_example_mismatch` (`warn`). |
| **Change path** | Never a value. Phase 3 can PR the *declaration* (`mushi.recipe.json`, `.env.example`). Setting a value reuses the existing guided `gh secret set NAME` commands with a placeholder. `sync-ci-secrets` stays limited to Mushi's own vars. |
| **Phase** | 1: existing Mushi-var presence. 2: declared vars. |

### 1.8 Integrations

| | |
|---|---|
| **Diagnosis value** | "Sentry has been down for 3 days for this project, so the queue is missing crash reports." |
| **Source (exists)** | `project_settings` integration columns (presence), the latest `integration_health_history` row per kind, and the routes in B3. |
| **Source (new)** | `recipe.integrations` declares the expected integrations (`sentry: {project}`, `slack`, `linear`). |
| **Drift** | `integration_declared_missing`; `integration_down_24h`; `sentry_project_mismatch` (the DSN project in the recipe ≠ the connected `sentry_project_slug`). |
| **Change path** | The existing console connect flows. No PR. |
| **Phase** | 1 (presence plus health); 2 (declared). |

---

## 2. `mushi.recipe.json`

Location: repo root (or `recipe.path` in project settings for monorepos). JSON, not YAML, because DTCG is JSON and one parser is enough. Rules:

- The size cap is 64 KB.
- The file is secret-scanned with `_shared/secret-scan.ts`; a hit rejects the snapshot with `SECRET_DETECTED`.
- Every string is untrusted. The file is wrapped before any LLM prompt.
- Unknown keys are kept and ignored.
- **`design.directions[]` rules.** `design.tokens[]` stays the single source of truth for drift; directions are for comparison only.
  - At most one entry may be `active`, and its `tokens` must equal the set of `role: "source"` paths in `design.tokens[]`. A mismatch is a validation error (`directions_active_mismatch`), so the board can never disagree with what drift checks.
  - Inactive directions are parsed and normalized for the side-by-side view (swatches, type, contrast). They never produce drift findings, never feed `get_design_tokens` by default (`?direction=<name>` opts in) and are never edited by a recipe PR.
- **Modes (light/dark) are not modelled in v1.** DTCG 2025.10 has no mode construct. A mode expressed as a scoped CSS selector (e.g. `html.dark:root[…]`) is read per scope, and the detail view shows one column per declared scope. A mode expressed in a tool's own `$extensions` stays informational.
- In token files, Mushi reads only `$extensions["us.kensaur.mushi"]`. Other namespaces (e.g. `us.kensaur.glot` with `alsoSets` and `contrast[]`) are preserved in the snapshot and shown read-only in the token detail view, but never interpreted. A namespace becomes interpreted only through a spec change here.

The schema is published at `apps/docs/public/schemas/recipe/v1.json` (served from the docs site) and validated with Zod in `_shared/recipe-schema.ts`.

Top-level keys, all optional except `version`:

| Key | Purpose |
|---|---|
| `version` | `1` |
| `app` | `{name, kind: "app"\|"site"\|"service"\|"library", platforms: ("web"\|"android"\|"ios")[], ids?: {bundleId?, androidPackage?, appStoreId?}}`. `kind` is mirrored to `projects.kind`. |
| `design` | `tokens[]` `{path, role: "source"\|"export", format: "dtcg-2025.10", generator?}`; `css[]` `{path, role, scopes?: string[]}` (selectors whose custom properties count, in addition to `:root` and `@theme`); `directions[]` `{name, status: "active"\|"inactive", tokens: string[], note?}` (candidate design directions kept for comparison; rules below); `components` `{globs[]}`; `literalScan` `{globs[], ignore[]}`; `assets[]` `{path, kind: "icon"\|"illustration"\|"image"\|"font"\|"lottie", license?}` (assets are not tokens) |
| `data` | `{provider: "supabase"\|"other", projectRef?, migrationsDir?}` |
| `routes` | `{inventory: "inventory.yaml"}` |
| `gates` | `{budgets: {<metric>: number}, cadence: {<gate>: "P1D"}}` |
| `ci` | `{provider: "github-actions", defaultBranch, workflows: {<file>: {role}}}` |
| `deploy` | `{targets: [{id, kind, environment, url?, probe: {type, url?}, workflow?, maxLagHours?}]}` |
| `env` | `{environments[], required: [{name, in[], environments[]}], example?: ".env.example"}` |
| `integrations` | `{sentry?: {project}, slack?: {}, linear?: {team}, posthog?: {project}, stripe?: {account}}` |
| `links` | Cross-project declarations for the portfolio. Each entry becomes a `portfolio_resource` use. Keys: `domains[]`; `deepLinks` `{schemes[], universalLinkDomains[], appLinks[]: {toProject: "<project slug>", path}}`; `auth` `{provider: "supabase"\|"clerk"\|"firebase"\|"other", ref?}`; `billing` `{stripeAccount?, sharedCreditsWith?: ["<project slug>"]}`; `notifications` `{slackChannel?, pushProvider?}`. |
| `connectors` | Optional per-project bindings: `{<kind>: {binding: "<external id>"}}`, e.g. `{"vercel": {"binding": "prj_…"}, "eas": {"binding": "<slug>"}}`. Never credentials; a manifest that contains anything shaped like a secret is rejected. |
| `change` | `{allowPaths[]}`: the only paths a recipe PR may write. The server rejects any glob that matches `.github/**`, `**/.env*` (except `.env.example`), lockfiles, or a token file declared `role: "export"`. |

Appendix B has a filled example for glot.it.

---

## 2b. Connectors: the pluggable source interface

### The interface (`_shared/connectors/types.ts`)

```ts
export type ConnectorCapability = 'snapshot' | 'drift' | 'propose' | 'act'

export interface RecipeConnector {
  kind: ConnectorKind                       // 'github' | 'supabase' | 'vercel' | 'eas' | 'app_store_connect'
                                            // | 'play_console' | 'stripe' | 'sentry' | 'posthog' | 'http'
  capabilities: readonly ConnectorCapability[]
  /** Scopes or permissions each capability needs; checked by probe(), shown in the console. */
  requiredScopes: Partial<Record<ConnectorCapability, readonly string[]>>
  /** Validates the credential and returns what it can actually do. Never throws for "denied". */
  probe(ctx: ConnectorContext): Promise<{ ok: boolean; granted: string[]; missing: string[]; error?: string }>
  /** Read-only. Returns recipe fragments plus the shared resources it saw. */
  snapshot(ctx: ConnectorContext, binding: ConnectorBinding): Promise<ConnectorSnapshot>
  /** Pure: previous vs next snapshot (+ manifest) → findings. No I/O. */
  detectDrift?(prev: ConnectorSnapshot | null, next: ConnectorSnapshot, manifest: RecipeManifest | null): DriftFinding[]
  /** Returns file edits only; the recipe-change worker opens the draft PR through the GitHub connector. */
  proposeChange?(ctx: ConnectorContext, change: RecipeChange): Promise<FileEdit[]>
  /** API mutation. Refuses to run without an approved connector_actions row whose payload hash matches. */
  act?(ctx: ConnectorContext, action: ApprovedConnectorAction): Promise<ConnectorActionResult>
}

export interface ConnectorSnapshot {
  observedAt: string
  elements: Partial<Record<RecipeElementKey, ElementFragment>>   // schema, design, routes, gates, ci, deploy, env, integrations
  resources: PortfolioResourceRef[]                              // {kind, externalId, role, metadata}
  cursor?: string                                                // incremental reads (e.g. CI runs)
}
```

The rules follow ADR 0013's adapter pattern:

- **One registry, `_shared/connectors/index.ts`.** An unknown kind is a 400, never a silent skip.
- **Snapshots are validated against the Zod schema.** A connector that returns invalid data writes `gate_runs.status='error'`, and the element renders `error`. It never renders `ok`.
- **`detectDrift` is pure.** It is tested from fixtures alone.
- **Only the GitHub connector writes files.** Other connectors' `proposeChange` returns edits, and the recipe-change worker turns them into a PR. For example, Stripe can propose a price-ID constant fix, and Vercel can propose a `vercel.json` change.

### Catalog

| Connector | Snapshot (read) | Drift examples | Propose (PR) | Act (API, approval) | Credential, least privilege | Phase |
|---|---|---|---|---|---|---|
| **GitHub** | Files at a pinned SHA, workflows, runs and jobs, secret and variable *names*, environments, deployments | `ci_drift`, `env_missing`, `not_deployed` | Yes, the only file writer | Later: re-run a workflow | Existing token ref (`resolveProjectGithubToken`). A fine-grained PAT needs Contents RW + Pull requests RW for propose, and Actions R + Secrets R (names) + Metadata R for snapshot; Workflows W only for the later workflow opt-in | 2 (refactor of existing helpers) |
| **Supabase** | Schema, applied migrations, RLS, functions, buckets, advisors, auth config, aggregate sign-up count | `schema_drift`, `migration_unapplied`, `auth_redirect_missing` | Via GitHub (migration *file*, later opt-in) | None | BYOK `supabase` PAT through `resolveSupabasePat`. **Supabase PATs are not scopable**, so Mushi calls only the hosted MCP with `read_only=true`, and the console says so | 2 (refactor of `backend-drift-scanner`) |
| **Generic HTTP** | The host's own endpoint returns a `ConnectorSnapshot` | Whatever its fragments imply | Returns `FileEdit[]` only | None | HMAC secret in Vault; Mushi signs requests with plugin-sdk `signPayload` (`t=…,v1=…`); 1 MB cap, Zod-validated, 10 s timeout | 2 |
| **Vercel** | Deployments per environment, env var *names* per target, domains | `not_deployed`, `env_missing`, domain missing from `links.domains` | `vercel.json` edits | Later: promote or redeploy | Vercel tokens are scoped to an account or team, not to permissions, so the console warns and Mushi uses read endpoints only | 2+ (pilot-driven) |
| **Expo / EAS** | Builds, updates per channel and branch, runtime versions | `platform_skew`, an update channel with no matching build | `app.json` / `eas.json` edits | Later: roll back an update | Robot-user token with the narrowest role that can read builds and updates | 2+ |
| **App Store Connect** | App versions, build processing, TestFlight, review state | A version stuck in review; build ≠ the recipe version | None | None in v1 | Team API key (.p8) with the narrowest role that can read builds and versions, checked by a read call at probe | 2+ |
| **Play Console** | Tracks, releases, version codes, rollout % | A halted rollout; track skew vs the web version | None | Later: promote a track or change rollout % | Service account invited with app-scoped read-only permission ("view app information") | 2+ |
| **Stripe** | Products, prices, webhook endpoints, live/test mode | A price ID in code that is missing in Stripe; a webhook URL ≠ the deployed domain | Constant or config edits | None | **Restricted key** (`rk_…`) with read-only resource permissions | 2+ |
| **Sentry** | Projects, DSNs, release health | `sentry_project_mismatch`, a release not uploaded | None | Existing: resolve an issue | Existing `sentry_auth_token_ref`; scopes `org:read`, `project:read`, `event:read` | 2 (adapter over existing columns) |
| **PostHog** | Projects, event definitions, daily sign-up/activation event counts (aggregates) | An event in code that is never seen; a funnel event stopped firing after a deploy | None | None | Personal API key with read-only scopes | 2+ (Plan 020 owns the analytics product) |

The credential and scope column records the design intent. Vendor permission models change, so each claim is **confirmed against the vendor's current docs when that connector is built**, and the console text comes from that check, not from this table. Where a claim turns out wrong, the safe direction is fewer capabilities.

### Push and legacy adapters (no credentials on Mushi's side)

| Adapter | Use |
|---|---|
| `POST /v1/ingest/recipe` (`apiKeyAuth`) | A whole manifest, tokens, findings or a snapshot fragment from any CI, including Jenkins, GitLab or a cron on a VPS. |
| `POST /v1/ingest/recipe/events` (`apiKeyAuth`) | `build.completed`, `deploy.completed`, `release.published` in one documented JSON shape. These become `ci_workflow_runs` / `deploy_observations` rows with `source='webhook'`, for systems Mushi cannot poll. |
| `POST /v1/ingest/spans` (exists) | OTel spans. Phase 2 derives `deploy_observations` from the `service.version` resource attribute where present. |
| `POST /v1/ingest/recipe/csv` (`jwtAuth`) | One-off import of resources: domains, bundle IDs, env names per environment, legacy servers. The CSV maps columns to `portfolio_resources`. It is an upload, never fetched from a URL. |

### Auth model

- **Credentials** are stored with the existing `vault_store_secret` and referenced from `connector_instances.read_credential_ref` / `write_credential_ref`. They are never returned to a client, and never logged (only the key prefix is shown).
- **Scope.** A connector instance belongs to an organization. Its `project_id` is null when it is shared, for example one Stripe account behind three apps. `connector_bindings` map an instance to the projects and external IDs it serves.
- **Precedence.** A project binding beats an organization default. The existing `project_settings` and `organization_integration_settings` refs are read through *legacy-backed* GitHub, Sentry, Slack and Linear connectors. No credential is migrated in v1.
- **Least privilege.** `requiredScopes` are shown before connect. `probe()` runs at connect time and daily. A missing scope disables only that capability, and the console names the missing scope. The write ref stays empty until `propose` or `act` is enabled.
- **Approval for `act`.** The flow is `connector_actions` (`pending_approval` → `approved` | `rejected` → `executed` | `failed`). The approval stores a SHA-256 of the exact payload, and `act()` refuses on mismatch. Execution is single-shot, audited in `org_audit_events`, and never bulk.

### Contract tests

`_shared/connectors/__tests__/contract.ts` runs against every connector with recorded fixtures:

- the snapshot validates against the schema;
- a denied probe → `ok:false` (no throw);
- a network failure → `error` state;
- `act` without approval → refused;
- `proposeChange` never returns a denied path.

## 3. Console: the Recipe page

**Route:** `/recipe`, project-scoped like `/code-health`. It is registered in `navRegistry.ts` with `sectionId: 'check'` (Advanced) and in the `quick-tools` "More tools" group (Quick). It also gets a "Recipe" chip on the project card that shows the worst element state.

**Canvas.** A fixed-layout React Flow canvas built on the `pdca-flow` pattern (a data file of positions plus custom nodes, with `FlowCanvasBackground`). It has four lanes, left to right:

| Sources | Build | Deploy | Runtime |
|---|---|---|---|
| Schema · Design system · Routes & stories | Gates · CI/CD | Targets (one node per declared target) | Env presence · Integrations · Mushi SDK · live reports |

- **Edges** show what feeds what: tokens → web target, migrations → schema → API routes, workflows → targets.
- **Each node** is an element card. It shows the state chip, a one-line reason ("never scanned — link your Supabase project"), the last-checked time and a findings count. A non-`ok` state gets a distinct shape and icon as well as a colour, so the state never relies on colour alone.
- **Clicking a node** opens the side panel (the `GraphSidePanel` pattern). The panel has three tabs: **What it is** (snapshot detail), **Drift** (findings, linking to `/code-health` or `/inventory` where those already render them) and **Change** (Phase 3: edit form → a preview diff → "Open draft PR").

**Detail views.**

| View | Contents |
|---|---|
| Design system | Swatches, type scale, spacing, radius, motion; the component list; the off-token literal list; a **direction board** comparing `design.directions[]` side by side (read-only, Phase 1b); one column per declared CSS scope (e.g. light and dark) |
| Schema | Table list plus a diff against the previous snapshot |
| CI | Recent runs and estimated minutes (Advanced) |
| Deploy | Expected vs observed version per target |
| Env | A matrix of environments × variables showing presence |

**List fallback.** Below 768 px, and for screen readers, the canvas is replaced by an ordered list of the same cards. The list is also the default under `prefers-reduced-motion`.

**Report detail tie-in.** When a report's fix is merged but `deploy_drift.not_deployed` is open for its target, the report header shows "Fixed — not live yet (prod is on `a1b2c3d`)".

---

## 3b. Portfolio: recipes rolled up across an organization

**Route:** `/portfolio`, organization-scoped and reached from the organization switcher.

### What it shows

**Project grid.** One card per project. Each card shows:

- the kind icon (app / site / service / library);
- the worst recipe state;
- open reports;
- the Mushi SDK version vs latest;
- estimated CI minutes in the last 30 days (Advanced);
- the last deploy and its lag.

**Shared-resources graph.** A React Flow canvas with projects on one side and `portfolio_resources` on the other. Resources include auth providers, Supabase projects, Stripe accounts, domains, deep-link domains, Slack channels, push keys and repos. The edges are "uses" links. Clicking a resource lists every project that uses it and any divergence between them.

**"Fix once" list.** Portfolio findings, grouped. Each group has one action: **suggest everywhere** (one fix prompt) or, in Phase 3, **open one draft PR per affected repo** (a batch of `recipe_change_jobs` sharing a `batch_id`).

### Cross-project rules

| Concern | Rule | Data | Phase |
|---|---|---|---|
| Same misconfiguration repeated | Any `gate_findings.rule_id` open in at least 2 projects of one organization → one group. **"Open" is defined once**: `gate_findings` has no status column, so an open finding is one from the **latest completed `gate_run` per (project, gate)** with `allowlisted = false`. Counting every historical run would inflate the groups (glot.it alone has 53 runs and 412 findings). | Existing `gate_findings`, `gate_runs` + `projects.organization_id` | **P1** |
| The same *security* misconfiguration repeated | P1 **cannot** show security repeats: no security findings exist yet (B4). They arrive as Supabase advisor results (`getSupabaseAdvisors`, `supabase-mcp-client.ts:133`) via the Supabase connector (RLS disabled, exposed functions, auth settings), plus `env_drift` (a required secret missing in several repos) and `ci_drift` (unpinned or untimed workflows). These are grouped by the same rule. | Supabase connector, `env_drift`, `ci_drift` | P2 |
| SDK version skew | Mushi SDK version per project and package (`project_sdk_observations`) vs `sdk_versions` latest for the same package; no observation → `unknown`; also the spread of shared libraries (`@supabase/supabase-js`, `react-native`, `next`) read from each repo's `package.json` | `sdk_versions`, SDK heartbeats; the GitHub connector for package.json | P1 (Mushi SDK), P2 (other libraries) |
| Integration coverage holes | A project missing an integration that its siblings have (Sentry, Slack, CI timeout, RLS) → a "hole" suggestion | `project_settings` presence, gate findings | **P1** |
| CI cost per repo | Estimated minutes per repo and workflow; the top 3 spenders (Advanced) | `ci_workflow_runs` | P2 |
| Shared auth provider | Projects on one `auth_provider` with divergent settings, or a missing redirect for a sibling's domain or scheme | Supabase connector | P2 |
| Shared credits and billing | Projects declaring `billing.sharedCreditsWith` must use the same Stripe account, and price IDs in each repo must exist there. Credit *flows* and entitlements belong to Plan 020 | Stripe connector, manifest | P2 |
| Cross-app deep links | For every `links.deepLinks.appLinks[]`: the target's `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` are fetched publicly with no credentials, and must list the target app's bundle ID / package. `deep_link_broken` if not | Public HTTP probe, manifest `app.ids` | P2 |
| Shared notification channels | Several projects posting to one Slack channel without a project tag; a push key shared across apps; a push key or certificate near expiry (where the connector exposes it) | `project_settings`, connectors | P2 |
| Tech-debt and holes | A recipe completeness checklist per kind: an app has crash reporting, a version probe and a deep-link file; a site has a version probe and security headers; a library has a release workflow. Each miss is an `info` finding with a suggested fix | Recipe snapshots | P2 |

### Data model

The tables are in §5.1:

- `portfolio_resources` and `portfolio_resource_uses`;
- `portfolio_findings`, for rules that are genuinely cross-project;
- the view `portfolio_repeated_findings`, which groups existing findings;
- `projects.kind`;
- `organization_id` on the recipe tables.

RLS on every organization-scoped table: member SELECT through `organization_members`; service-role write.

### Access for agents

The existing account-level keys (`is_org_scoped`) resolve to *every project the key owner owns* (`_shared/auth.ts:36`). Portfolio routes and tools must instead resolve to **the organization's projects ∩ projects the key owner may access**, via `organization_members`. This is a server-side intersection; existing keys keep working.

The console uses JWT from P1. MCP portfolio tools ship in P1 behind that intersection, with a test that a key cannot read a sibling organization.

## 4. MCP

| Tool | Scope | Returns |
|---|---|---|
| `get_app_recipe` (new) | `mcp:read` | Per element: `{state, reason, lastCheckedAt, summary}`; plus the manifest and the snapshot hash. Untrusted strings are wrapped. |
| `get_design_tokens` (new) | `mcp:read` | The normalized tokens, filterable by group or type, plus the CSS var / TS name map. **This is the tool that makes agent fixes use tokens.** |
| `get_recipe_drift` (new) | `mcp:read` | Open recipe findings across the four new gates, with suggested patches or commands for the detect-and-suggest elements (CI, schema, env). |
| `propose_recipe_change` (new) | `mcp:write` | A dry run by default. It returns the file diff and the allowlist check. `confirm: true` creates the draft PR. The server instructions list it alongside `merge_fix` and `dispatch_fix` as a tool to confirm with the user first. |
| `list_gate_findings` (changed) | | The gate enum adds `design_drift, ci_drift, deploy_drift, env_drift`. |
| `get_portfolio` (new, P1) | `mcp:read` (account-level key, organization-intersected) | Projects with kind, worst state, SDK version and open reports; shared resources (P2); counts of "fix once" groups. |
| `list_portfolio_findings` (new, P1) | `mcp:read` | Repeated and cross-project findings with affected projects and a suggested fix. This is how "simple triage from Cursor or Claude Code" works across all apps: the agent asks for the portfolio's open groups and fixes them repo by repo. |
| `list_connectors` (new, P2) | `mcp:read` | Connector instances, bindings, granted vs missing scopes, last probe. Never credentials. |
| `propose_portfolio_change` (new, P3) | `mcp:write` | Dry run by default; `confirm: true` opens one draft PR per affected repo (a batch). Confirm with the user first. |
| `request_connector_action` (new, later) | `mcp:write` | Creates a `connector_actions` row in `pending_approval`. **It cannot approve.** Approval happens only in the console by a human. |
| `get_fix_context` (changed) | | Adds a `recipe` block, capped at 4 KB: tokens referenced in the files the fix touches, tables named in the stack trace, and the deploy state of the last fix. |

Catalog, hosted manifest (`_shared/mcp-hosted-tool-manifest.json`), generated docs and the pinned count update together. `pnpm check:catalog-sync` enforces this.

CLI: `mushi recipe init` (writes a starter manifest from what Mushi observed), `mushi recipe check` (validates the manifest and tokens locally, runs the off-token literal scan, and pushes findings with `--push`), and `mushi recipe show`.

---

## 5. Data model and routes

### 5.1 Migrations

Phase 1 has no migrations. Timestamps below are placeholders and must sort after Plan 018's `20261002120300`. They are renamed to the real apply time when applied, because the ledger is reconciled to on-disk filenames.

1. **`20261002130000_app_recipe_snapshots.sql`** (Phase 1b)
   - `app_recipe_snapshots`:
     - `id`, `project_id` → `projects` ON DELETE CASCADE;
     - `organization_id` → `organizations`, denormalized for portfolio rollups and set from `projects` by trigger;
     - `commit_sha`, `source` (CHECK `repo_file | ci_ingest | derived | connector`);
     - `manifest jsonb`, `tokens jsonb`, `tokens_hash text` (CHECK length 64), `components jsonb`;
     - `validation_errors jsonb not null default '[]'`;
     - `is_current bool`, `captured_at`.
   - Partial unique index on `(project_id) where is_current`. Index on `(project_id, captured_at desc)`.
   - RLS: member SELECT (the `backend_schema_snapshots` policy shape); service-role write.
2. **`20261002130100_recipe_gate_types.sql`** (Phase 1b; adds all four names at once, which is harmless)
   - Extend `gate_runs_gate_check` with `design_drift, ci_drift, deploy_drift, env_drift`.
   - Re-run the full current list from `pg_constraint`, not from the 2026-06-12 migration, which predates `code_health`.
3. **`20261002130200_ci_workflow_runs.sql`** (Phase 2)
   - `ci_workflow_runs`:
     - `project_id`, `repo_id` → `project_repos`;
     - `run_id bigint`, `workflow_path`, `name`, `event`, `head_branch`, `head_sha`;
     - `status`, `conclusion`, `started_at`, `completed_at`;
     - `est_billable_minutes numeric`, `runner_breakdown jsonb`, `html_url`;
     - `organization_id`; `source` (CHECK `github | webhook`).
   - Unique `(repo_id, run_id)`. Webhook rows use a host-supplied `run_id` under a synthetic repo row.
   - 90-day retention through `retention-sweep`. Member SELECT; service-role write.
4. **`20261002130300_deploy_observations.sql`** (Phase 2)
   - `deploy_observations`:
     - `project_id`, `target_id text`, `kind`, `environment`;
     - `observed_version`, `observed_commit`;
     - `source` (CHECK `version_json | github_deployment | sdk_heartbeat | connector | webhook | otel`);
     - `organization_id`, `ok bool`, `error text`, `observed_at`.
   - 90-day retention.
5. **`20261002130400_recipe_change_jobs.sql`** (Phase 3)
   - Columns mirror `sdk_upgrade_jobs`: `status`, `plan jsonb` (`element`, `edits[]`, `paths[]`), `pr_url`, `pr_number`, `branch`, `commit_sha`, `check_run_*`, `pr_state`, `merged_at`, `error`, timestamps.
   - Plus `organization_id` and `batch_id uuid` (nullable): one portfolio "fix once" request becomes one job per affected repo with a shared `batch_id`.
   - Partial unique index on `(project_id, element) where status in ('queued','running','pr_opened')`.
   - Stuck reaper copied from `20260828100000_sdk_upgrade_jobs_stuck_reaper.sql`.
   - Service-role only, like `sdk_upgrade_jobs`.
6. **`20261002130500_portfolio_resources.sql`** (Phase P2)
   - `projects.kind text` (CHECK `app | site | service | library | other`, nullable). P1 derives the kind (native SDK heartbeat → app, otherwise site) and labels it "inferred".
   - `portfolio_resources`:
     - `id`, `organization_id`;
     - `kind` (CHECK `auth_provider | supabase_project | stripe_account | domain | deep_link_domain | bundle_id | push_channel | slack_channel | posthog_project | sentry_project | repo | legacy_system`);
     - `external_id`, `metadata jsonb`.
     - Unique `(organization_id, kind, external_id)`.
   - `portfolio_resource_uses`:
     - `resource_id`, `project_id`, `role` (e.g. `auth`, `billing`, `deep_link_target`);
     - `source` (CHECK `manifest | connector | csv | inferred`), `observed_at`.
     - Unique `(resource_id, project_id, role)`.
   - `portfolio_findings`:
     - `id`, `organization_id`, `rule_id`, `severity`, `project_ids uuid[]`, `resource_id`;
     - `message`, `evidence jsonb`, `suggested_fix jsonb`;
     - `status` (`open | resolved | allowlisted`), timestamps.
   - View `portfolio_repeated_findings`: open `gate_findings` (latest completed run per project and gate, not allowlisted; §3b) grouped by `(organization_id, rule_id)` with `count(distinct project_id) >= 2`, created with `security_invoker = true` so RLS applies. P1 runs the same grouping as a query inside the route, with no migration, and this view replaces it.
   - RLS on all: SELECT for `organization_members` of the organization; service-role write.
7. **`20261002130600_connectors.sql`** (Phase 2)
   - `connector_instances`:
     - `id`, `organization_id`, `project_id` (nullable = shared across the organization), `kind`;
     - `display_name`, `read_credential_ref`, `write_credential_ref` (vault refs);
     - `granted_scopes text[]`, `enabled_capabilities text[]` (CHECK ⊆ `snapshot, drift, propose, act`);
     - `config jsonb`, `status`, `last_probe_at`, `last_ok_at`, `last_error`.
   - `connector_bindings`: `connector_instance_id`, `project_id`, `external_id`, `role`; unique `(connector_instance_id, project_id, role)`.
   - Service-role only for credentials. Members read a view without the `*_ref` columns.
8. **`20261002130700_connector_actions.sql`** (later, when the first `act` capability is enabled)
   - `connector_actions`:
     - `id`, `organization_id`, `connector_instance_id`, `action`;
     - `payload jsonb`, `payload_sha256`;
     - `status` (`pending_approval | approved | rejected | executed | failed`);
     - `requested_by` (user or `mcp:<key prefix>`), `approved_by`;
     - timestamps, `result jsonb`.
   - Approval is accepted only through a JWT console route and never through an API key.
9. **pg_cron** (Phase 1b, manifest and tokens only; Phase 2 widens what it collects): `recipe-collector-daily` at an offset minute (03:35 UTC, clear of the drift scanner at 03:05) via `edge_function_post`. Run the job once by hand and read `cron.job_run_details` afterwards; this applies the PL/pgSQL hot-helper lesson.

### 5.2 Routes

| Route | Auth | Phase | Purpose |
|---|---|---|---|
| `GET /v1/admin/projects/:id/recipe` | `adminOrApiKey(mcp:read)` | 1 | Composes all 8 elements → `{elements: {[key]: {state, reason, lastCheckedAt, summary, links}}, manifest?, snapshotHash?}` |
| `GET /v1/admin/projects/:id/recipe/elements/:element` | `adminOrApiKey(mcp:read)` | 1 | Detail for the side panel |
| `POST /v1/admin/projects/:id/recipe/refresh` | `adminOrApiKey(mcp:write)` | 1b | Enqueues `recipe-collector` for this project; rate-limited to 1 per 5 minutes |
| `GET /v1/admin/projects/:id/recipe/history` | `adminOrApiKey(mcp:read)` | 1b | Snapshot list plus the token/schema diff between two snapshots |
| `POST /v1/ingest/recipe` | `apiKeyAuth` | 1b | Host CI pushes the manifest, tokens, findings (`off_token_literal`, schema hash) for repos without a GitHub token. This is the standalone path. |
| `POST /v1/admin/projects/:id/recipe/changes` | `adminOrApiKey(mcp:write)` | 3 | `{element, edits, dryRun=true}` → a diff preview; `dryRun:false` → a job plus a fire-and-forget worker call |
| `GET /v1/admin/projects/:id/recipe/changes/:jobId` and `/stream` | `adminOrApiKey(mcp:read)` | 3 | Status poll and SSE (the `useSdkUpgrade` pattern) |
| `GET /v1/admin/orgs/:orgId/portfolio` | `adminOrApiKey(mcp:read)`, organization-intersected | P1 | Per-project recipe summaries (the same composer as the project route, run per project and bounded to 25 projects per page), SDK skew, repeated-finding groups, integration holes |
| `GET /v1/admin/orgs/:orgId/portfolio/findings` | `adminOrApiKey(mcp:read)` | P1 | Groups with affected projects and a suggested fix |
| `GET /v1/admin/orgs/:orgId/portfolio/resources` | `adminOrApiKey(mcp:read)` | P2 | The resource ↔ project graph |
| `POST /v1/admin/orgs/:orgId/portfolio/changes` | `adminOrApiKey(mcp:write)` | 3 | A batch of draft PRs, one per affected repo; dry run by default |
| `GET/POST /v1/admin/orgs/:orgId/connectors`, `POST …/:id/probe`, `PATCH …/:id` (capabilities), `DELETE …/:id` | `jwtAuth` (create, delete, enable capabilities); `adminOrApiKey(mcp:read)` for GET | P2 | Connect, probe, bind to projects, enable capabilities |
| `POST /v1/ingest/recipe/events` | `apiKeyAuth` | P2 | Legacy build, deploy and release events |
| `POST /v1/ingest/recipe/csv` | `jwtAuth` | P2 | Resource import |
| `POST /v1/admin/connector-actions/:id/approve` and `/reject` | `jwtAuth` only | later | Human approval of `act` calls |

### 5.3 Edge functions

Follow AGENTS.md "Adding a new agent" for both.

- **`recipe-collector`** (Phase 1b reads the manifest and token files only; Phase 2 adds the rest; `requireServiceRoleAuth`; daily cron plus refresh):
  - reads the manifest and token files at HEAD of the default branch;
  - normalizes the DTCG (`_shared/dtcg.ts`);
  - lists workflows and new runs;
  - probes deploy targets;
  - lists env names;
  - writes the snapshot, runs and observations, then `gate_runs` / `gate_findings`.
  - From Phase 2 it is connector-driven. For each project it runs `probe` (daily), `snapshot` and `detectDrift` of every bound connector with `snapshot` enabled. It merges the fragments into one recipe and upserts `portfolio_resource_uses`. It then evaluates the cross-project rules once per organization.
  - It is bounded per run: at most 25 projects and 10 connectors per project, plus a per-connector timeout. A connector that times out marks only its own elements `error`.
- **`recipe-change-worker`** (Phase 3; `requireServiceRoleAuth`):
  - builds the file edits from `plan`;
  - re-checks the allowlist against the live tree;
  - calls `createPrFromFiles({…, markReady: false})` after a `findOpenPrByHeadPrefix('mushi/recipe-<element>')` dedupe.

### 5.4 Shared modules

| Module | Role |
|---|---|
| `_shared/recipe-state.ts` | Pure `deriveElementState(inputs) → {state, reason}`, one function per element. Every unknown path is unit-tested. |
| `_shared/recipe-schema.ts` | Zod schema for `mushi.recipe.json`, plus the allowlist validator (`isWritablePath`) with its deny rules. |
| `_shared/dtcg.ts` | Parse and normalize: 2025.10 objects, legacy hex/`px` shorthand, flat dotted keys → nested groups, alias resolution (`{a.b}` and `$ref`), cycle detection; output `{tree, flat: Map<path, {type, value, cssVar?}>, issues[]}`. Covered by fixture tests: Mushi's `brand.tokens.json`, glot's `dtcg/tokens.json`, and the 2025.10 spec examples. |
| `_shared/secret-scan.ts` | Extracted from skill-sync and sdk-assistant. Both keep their behaviour; their tests stay green. |
| `_shared/sdk-diagnostics.ts` | Extracted from `project-ci-secrets.ts`. |
| `_shared/ci-minutes.ts` | Pure job-duration estimator with tests. |
| `_shared/connectors/` | `types.ts` (the §2b interface), `index.ts` (the registry), one file per connector, and `__tests__/contract.ts`. GitHub, Supabase and Sentry wrap the existing helpers (`github.ts`, `github-pr.ts`, `supabase-mcp-client.ts`, the Sentry columns) and do not replace them. |
| `_shared/portfolio-rules.ts` | Pure cross-project rules: repeated findings, SDK skew, holes, auth divergence, deep links, shared channels. Each one is tested from fixtures. |

---

## 6. Push-changes security model

| Threat | Control |
|---|---|
| Mushi writes somewhere it should not | Writes only through `createPrFromFiles` onto a new `mushi/recipe-*` branch. Never the default branch, never a force push, never `.env*` (except `.env.example`), lockfiles, generated token exports or binary files. `.github/**` and migration files are denied in v1 and become per-project opt-ins later (decision 6). The allowlist is the intersection of `recipe.change.allowPaths` and the deny rules, checked twice: when the plan is built and in the worker against the live tree. |
| A recipe PR burns the host's CI | `markReady: false`. The PR stays in draft. The owner clicks "Ready for review" on GitHub, or uses the console's existing merge loop, which re-readies it (`mergeGithubPullRequest`). |
| A token with too much scope | The token is the user's own vault reference (B1). Mushi requests nothing new. The console states the scopes a recipe PR uses (`contents:write`, `pull_requests:write`) and checks them with a dry-run `GET` before enabling the Change tab. |
| A malicious or poisoned `mushi.recipe.json` (prompt injection, path tricks) | Size cap, Zod schema, path normalization (no `..`, no absolute paths, no symlinks: the Contents API `type` must be `file`), secret scan, and wrapping before any prompt. Manifest strings never become shell commands. `generator` is shown to the user, never run. |
| Secret values | Never read or written. Names only. Guided commands carry `<value>` placeholders. |
| SSRF through user-supplied URLs (version probes, deep-link files, the HTTP connector) | One `_shared/safe-fetch.ts` for all of them, with these rules: https only; DNS resolved and private, loopback, link-local and metadata ranges refused (including after a redirect); at most 3 redirects; 10 s timeout; 1 MB body cap; no credentials, except the HTTP connector's HMAC signature. |
| A connector credential with too much power | Separate read and write refs; `probe()` records granted scopes; capabilities off by default. The console shows when a vendor's token cannot be scoped (Supabase PAT, Vercel token) and then uses read endpoints only. |
| An `act` call goes wrong (promote, rollback) | No `act` ships enabled in v1. When one is enabled, every call needs a human approval in the console (JWT only; an MCP key can request but never approve). The approval binds a SHA-256 of the exact payload; execution is single-shot and audited in `org_audit_events`. |
| Portfolio data leaks across organizations | Organization-scoped RLS; account-level keys intersected with `organization_members`; a test that a key from organization A cannot read organization B's portfolio, findings or resources. |
| Runaway jobs | One active job per (project, element); a stuck reaper; a rate limit on `/changes`; every PR body names the job ID and the requesting user, and an audit log row is written. |
| Public-repo disclosure | Repo memory: a security fix is deployed before it is pushed. Recipe drift findings are never posted to the host repo as issues or comments; they stay in Mushi. |

---

## 7. Rollout

The sequencing gate from ADR 0016 applies.

| Phase | Gate | What it delivers |
|---|---|---|
| **1** | Outside (no migration) | One project's recipe from existing data. The thin activation slice. |
| **1b** | Outside | The design-token slice, so glot.it's new design system is ingested from its first commit |
| **P1** | Outside (no migration) | The portfolio rollup of Phase 1 recipes |
| **2 and P2** | Gated | Connectors, collectors and cross-project rules |
| **3** | Gated | Push changes |

Gated phases start when at least 3 external projects are activated or the owner sets a review date, whichever comes first. The owner may strike the gate.

Order: 1 → 1b → P1 → 2 → P2 → 3. **Nothing portfolio-shaped blocks Phase 1.** Phase 1 still writes `organization_id`-ready code paths, with the composer taking a project ID and returning a self-contained summary, so P1 only has to loop over it.

### Phase 1 — light up the page from existing data (no migrations)

- [ ] `_shared/recipe-state.ts` with tests for every element state, especially schema with no snapshot, deploy `unknown` and a stale gate.
- [ ] Extract `_shared/sdk-diagnostics.ts` and `_shared/secret-scan.ts`; existing tests pass unchanged.
- [ ] `GET /v1/admin/projects/:id/recipe` and `/elements/:element`, composing the sources below:

  | Element | Source |
  |---|---|
  | Schema | Latest `backend_schema_snapshots`, otherwise `not_connected` |
  | Design | `not_connected` plus a link to the format doc |
  | Routes | `inventories` / `graph_nodes` counts and inventory findings |
  | Gates | Last completed `gate_runs` per gate, plus its non-allowlisted `gate_findings` (the "open" definition in §3b), and the latest `metric_series` per family |
  | CI | The latest default-branch run via `fetchLatestWorkflowRunForSha` (5-minute cache) plus `fix_attempts` / `sdk_upgrade_jobs` check-runs |
  | Deploy | Latest `releases` plus the 30-day `app_version` spread from `reports.environment`, shown as `unknown — no deploy signal` |
  | Env | Shared sdk-diagnostics |
  | Integrations | `project_settings` presence plus the latest health row per kind |

- [ ] `/recipe` page: the canvas and list fallback, side panel with **What it is** and **Drift** tabs, the nav registry entries, and the project-card chip.
- [ ] MCP `get_app_recipe`; catalog, manifest and count synced.
- [ ] Docs: `apps/docs/content/concepts/app-recipe.mdx`, framed as diagnosis context (`check:admin-docs-coverage`, `check:internal-doc-links`).
- [ ] **Acceptance on glot.it:** all 8 cards render. Schema = `not_connected`, design = `not_connected`, deploy = `unknown`, routes/gates/CI/env/integrations show real data. The API JSON and a screenshot are kept as evidence.

### Phase 1b — the recipe file and design tokens (outside the gate)

- [ ] Migrations 1–2 and the cron. `_shared/recipe-schema.ts` and `_shared/dtcg.ts` with fixtures (Mushi brand, glot export, spec examples).
- [ ] `recipe-collector` limited to the manifest and token files. `POST /v1/ingest/recipe`, `/refresh`, `/history`.
- [ ] CLI `mushi recipe init | check | show`, with the off-token literal scan.
- [ ] Design-system detail view (swatches, type, spacing, motion, components, off-token list). The design card moves from `not_connected` to real states.
- [ ] MCP `get_design_tokens`. The `recipe` block in `get_fix_context` and the `fix-worker` prompt, with tokens only at this stage.
- [ ] **glot.it pilot:**
  - commit `mushi.recipe.json` (Appendix B);
  - author the new design system as a `role: "source"` DTCG file;
  - add a `mushi recipe check --push` step to glot's **existing** `ci.yml` job (no new job; ci-cost rule 3), in glot's next release batch.

### Phase P1 — portfolio from existing data (no migrations, outside the gate)

- [ ] `GET /v1/admin/orgs/:orgId/portfolio` and `/findings`, built on the Phase 1 composer:
  - the repeated-finding grouping as a route query;
  - Mushi SDK skew;
  - integration holes;
  - kind inferred from SDK heartbeats.
- [ ] Organization intersection for account-level keys, with a cross-organization denial test.
- [ ] `/portfolio` page with the project grid and the "fix once" list (suggest-only). Organization switcher entry.
- [ ] MCP `get_portfolio` and `list_portfolio_findings`.
- [ ] **Acceptance on the owner's 7-project organization:**
  - 7 cards;
  - the SDK skew list matches `sdk_versions` per package, with mushi-demo rendered `unknown`;
  - at least one repeated `rule_id` group, if one exists in production data, or an explicit "no repeated findings" state;
  - the API JSON and a screenshot are kept as evidence.

### Phase 2 — connectors, collectors and drift for schema, CI, deploy, env and integrations (gated)

- [ ] Migrations 3–4 and 7. `_shared/connectors/` with the interface, registry and contract tests.
  - GitHub, Supabase and Sentry are legacy-backed connectors over the existing helpers and columns.
  - The generic HTTP connector, `/v1/ingest/recipe/events` and `_shared/safe-fetch.ts` land here too.
  - `_shared/ci-minutes.ts` with fixtures.
- [ ] Connector console: connect, probe, bind, granted vs missing scopes; MCP `list_connectors`.
- [ ] Further connectors (Vercel, EAS, App Store Connect, Play Console, Stripe, PostHog) are added **one at a time, when a pilot project needs them**. Each passes the contract suite before it ships.
- [ ] `recipe-collector` widened:
  - schema declared-vs-applied (§1.1);
  - CI rules (§1.5);
  - deploy probes (§1.6), including glot's `version.json` probe on the web target;
  - declared env (§1.7);
  - declared integrations (§1.8);
  - budgets and cadence (§1.4).
- [ ] MCP `get_recipe_drift`; the `list_gate_findings` enum; schema and deploy state added to the `recipe` block of `get_fix_context`.

### Phase P2 — cross-project rules (gated)

- [ ] Migration 6: `projects.kind`, `portfolio_resources`, `portfolio_resource_uses`, `portfolio_findings`, the view.
- [ ] `_shared/portfolio-rules.ts`:
  - shared auth divergence;
  - billing and shared credits consistency;
  - the deep-link probes (through `safe-fetch`);
  - shared channels;
  - CI cost per repo;
  - the kind-based completeness checklist (holes and tech debt).
- [ ] Shared-resources graph on `/portfolio`; CSV resource import for legacy systems.
- [ ] **Acceptance:** the owner's organization resolves at least one shared resource used by 2+ projects (e.g. a Slack channel or a GitHub organization). A deliberately removed `assetlinks.json` entry on a test domain produces `deep_link_broken`.

### Phase 3 — push changes

- [ ] Migration 5. `createPrFromFiles` gains `markReady`; existing callers are unchanged, with a regression test that `fix-worker` still readies its PRs.
- [ ] `recipe-change-worker`; `/changes` routes; the console Change tab (token edit, budget edit, env declaration edit, inventory proposal → PR) with a preview diff.
- [ ] MCP `propose_recipe_change` (dry run by default; confirm before write).
- [ ] Portfolio "fix once" batches: `POST /v1/admin/orgs/:orgId/portfolio/changes` → one job per affected repo with a shared `batch_id`; MCP `propose_portfolio_change`. Each repo's PR is independent and stays in draft. One repo failing does not roll back the others; the batch view says which repos succeeded.
- [ ] (Later, separate owner decision) the first `act` capability plus migration 8 and the approval routes.
- [ ] **Acceptance:** one token edit and one budget edit on glot.it each open a draft PR that touches only allowlisted paths. A deliberate `.github/workflows/x.yml` edit is rejected with 400 `PATH_NOT_WRITABLE`. The owner merges by hand.

### Release batching

Each phase is one release batch (ci-cost rule 7): server (migrations → functions → api) → admin → npm (`@mushi-mushi/mcp`, `mushi-mushi` CLI minor) → the glot.it adoption PR folded into glot's next batch.

---

## 8. Non-goals and risks

**Non-goals:**

- store, EAS or hosting-provider credentials **before Phase 2**; after that, only through a connector, read-only by default;
- triggering deploys or re-running workflows without an approved `connector_actions` row (none ships enabled in v1);
- writing secret values or running DDL, ever; `.github/**` and migration files only as later opt-ins;
- Figma sync (Tokens Studio already does this; a designer exports DTCG to the repo);
- team ownership, on-call or per-team scorecards (Backstage, Port and Cortex territory). The portfolio is one person's or one small team's organization, not an enterprise catalog;
- GTM, marketing, analytics funnels, credit *economies* and cross-app notification products. These are **Plan 020 (in progress)**, which consumes this plan's resources and connectors;
- running third-party connector code on Mushi's edge (out-of-tree sources use the HTTP protocol or push);
- executing any host code, including Tailwind configs and generators;
- `integration_health_history` retention (separate follow-up).

| Risk | Mitigation |
|---|---|
| Positioning drift: the console becomes an ops portal | The ADR 0016 rules: a drift-test line per element, Advanced-only CI cost, never on a public surface, and the proposed AGENTS.md line. The positioning guard stays green. |
| Activation is still 0 external projects | The sequencing gate. Phase 1 is cheap and makes Mushi's own dogfood projects legible. Phases 2 and 3 wait. |
| Solo-founder bandwidth | Phase 1 reuses existing reads. Each phase is shippable alone. Phase 3 can be dropped without stranding Phases 1–2. |
| Silent fail-open (shipped 4× in this repo) | Five explicit states, unknown ≠ ok, a test per unknown path, and collectors write `gate_runs.status='error'` on failure rather than skipping. |
| Pushing into user repos | §6. Draft-only, allowlist, no workflows, no secrets, no DDL, dedupe, audit. |
| Poisoned manifest or tokens fed to an LLM | Secret scan, size cap, schema validation, and wrapping before prompts. The `recipe` block in `get_fix_context` is capped at 4 KB. |
| GitHub API rate and cost | Daily plus on-demand only. Run listing is cursor-based. Job details are fetched only for completed runs not yet stored. The page cache is 5 minutes. No GitHub Actions minutes are spent on Mushi's side. |
| DTCG spec churn and legacy files | The normalizer accepts the legacy shorthand and flat keys with an `info` finding. Fixtures pin both real repos' files. |
| Two token sources in one app (glot: TS → DTCG export) | `role: "source"\|"export"`. An export file is read-only in Mushi; the editor shows where the source lives. |
| Scope explosion: "one-stop platform for everything" turns into a Port-style IDP | Portfolio rules exist only where a cross-project concern changes a diagnosis or a fix. Connectors beyond GitHub, Supabase, Sentry and generic HTTP are added one at a time when a pilot needs them. GTM and analytics live in Plan 020, not here. |
| Connector maintenance (vendor API churn) on a solo founder | Contract tests with recorded fixtures per connector; a probe failure renders `error`, never stale `ok`. The generic HTTP and push adapters let a long-tail system plug in without Mushi writing a connector. |
| Unscopable vendor tokens (Supabase PAT, Vercel token) | Read endpoints only, the read-only MCP for Supabase, and the console states the token's real power before connect. |
| Cross-organization leakage through account-level keys | The organization intersection plus a denial test (§6). |
| A portfolio "fix once" batch amplifies a bad change across repos | Dry run first; one draft PR per repo; nothing is merged automatically; a batch is capped at 10 repos per request. |

---

## 9. Verification

- **Phase 1:** Deno tests for `recipe-state` (the no-permission-flag CI command, per repo memory), `secret-scan` and `sdk-diagnostics` extraction parity. A route contract test. `pnpm typecheck`, `lint` and `build`, then `check:drift`, `check:design`, knip and `check:catalog-sync`. Deploy `api` from a clean worktree (repo memory). Live checks: `curl` the recipe route for glot.it as an admin and as an API key with `mcp:read`, and as `anon` (expect 401). A headed Playwright pass of `/recipe` at 1440 and 390 px in light and dark mode, plus an axe run.
- **Phase 1b:**
  - Migrations applied and re-queried in `information_schema` and `pg_constraint` (the new gate names present, the old ones kept).
  - `get_advisors` clean.
  - The cron run once by hand and `cron.job_run_details` read.
  - DTCG fixture tests (Mushi brand, glot export, spec examples).
  - glot.it:
    - the snapshot row exists;
    - a known off-token literal produces one `off_token_literal` finding;
    - `get_fix_context` for a glot report contains the `recipe` block with tokens.
- **Phase P1:**
  - A route test that the portfolio of a 7-project fixture organization returns 7 summaries.
  - A cross-organization denial test for an account-level key.
  - Live: `curl` `/v1/admin/orgs/:orgId/portfolio` for the owner's organization as JWT and as an account-level key, and as a key belonging to another organization (expect 403).
  - Headed Playwright of `/portfolio` at 1440 and 390 px.
- **Phase 2:**
  - Migrations 3–4 and 7 verified the same way.
  - The connector contract suite passes for GitHub, Supabase, Sentry and HTTP.
  - A connector with a revoked token renders `error`, not `ok`, on the next run.
  - `safe-fetch` refuses `http://169.254.169.254/` and a redirect to `http://localhost`.
  - glot.it's `version.json` probe writes an observation whose commit matches glot's last deploy.
  - A deliberately unapplied migration produces `migration_unapplied` (once a Supabase ref is linked).
  - A workflow without `concurrency` produces `workflow_no_concurrency`.
- **Phase P2:**
  - Migration 6 verified; `get_advisors` clean, including the `security_invoker` view.
  - Rule fixtures for auth divergence, deep links, shared channels, billing and holes.
  - Live: the deep-link acceptance in §7.
- **Phase 3:**
  - The worker test suite covers the allowlist deny cases.
  - A 2-repo batch where one repo has no token: one draft PR plus one failed job, with the batch status saying so.
  - A `fix-worker` regression test confirms its PRs are still readied.
  - A live token edit on glot.it → a draft PR (verified with `gh pr view --json isDraft,files`).
  - The workflow-file edit is rejected.
  - The owner merges by hand.

---

## Appendix A — competitive scan (checked 2026-10-02)

| Product | What it is | How Mushi's recipe differs for a solo vibe-coder |
|---|---|---|
| **Backstage** (CNCF, open source, from Spotify) | A software catalog: "a centralized system that keeps track of ownership and metadata for all the software in your ecosystem", stored as `catalog-info.yaml` beside the code; scorecards and CI views are plugins ([backstage.io](https://backstage.io/docs/features/software-catalog/)). | Self-hosted and plugin-assembled; it assumes a platform team and many services. Mushi has one app per project, zero setup for the derived recipe, and the recipe exists to explain bugs, not to record ownership. Borrowed: config-as-code beside the source. |
| **Port** | An IDP with a configurable data model ("blueprints"), software catalog, scorecards, self-service actions and AI agents. Free up to 15 seats; Basic $30 and Standard $40 per seat per month ([port.io/pricing](https://www.port.io/pricing)). | A blank-canvas modelling tool; you design the catalog. Mushi ships a fixed eight-element recipe that already means something for a Next/Expo/Capacitor + Supabase app. Borrowed: actions as reviewed runs. |
| **Cortex** | An IDP centred on scorecards (standards graded per service), initiatives and engineering-intelligence (DORA) dashboards. Pricing is not published; third parties estimate about $65–69 per user per month ([dupple.com](https://dupple.com/learn/best-internal-developer-portals), estimate). | Grades teams against standards. Mushi grades one app against **its own declared recipe** and turns a deviation into a diagnosis or a draft PR. Mushi has no per-seat economics for a solo user. |
| **Tokens Studio** | A Figma plugin that two-way syncs design tokens with GitHub (JSON, DTCG format optional), with branches as a pro feature ([docs.tokens.studio](https://docs.tokens.studio/token-storage/remote/sync-git-gitlab), [format](https://docs.tokens.studio/manage-settings/token-format)). | The designer's side. Mushi does not sync Figma; it reads whatever DTCG lands in the repo, which can come from Tokens Studio, and checks that the *shipped code* uses it. |
| **Supernova** | A design-system platform: exporters turn design data into code (CSS, Tailwind, iOS, Android, Flutter), and pipelines open a PR against your repo, "never directly committing to production branches" ([developers.supernova.io](https://developers.supernova.io/latest/exporters/delivery-pipelines-BlKUaNI9)). | The closest analogue to Phase 3's PR model, which validates it. But it is design → code only; it does not see schema, CI, deploy or bugs. |
| **Specify** | A design token engine syncing Figma to repos with automatic GitHub PRs. **Reported as shut down** ([W3C DTCG log, 2025-01-27](https://lists.w3.org/Archives/Public/public-design-tokens-log/2025Jan/0024.html): "Specify is shutting down too"). | A caution: token sync alone is a thin standalone business. That is why Mushi makes the recipe context for the diagnosis, not the product. |
| **Vercel dashboard** | Per-project deployments, preview deployments per PR, environment variables scoped to development / preview / production, and observability ([vercel.com/docs](https://vercel.com/docs/dashboard-features)). | Single-provider, and it only knows what Vercel deploys. Mushi reads Vercel's GitHub Deployments if present, also covers S3/CloudFront, Capacitor and stores, and links "fix merged" to "fix live". |
| **Netlify** | Deploy previews per PR (`deploy-preview-N--site`) and per-context env vars, including untrusted-deploy handling ([docs.netlify.com](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)). | Same as Vercel: one provider, no bug linkage. |
| **Expo EAS Insights** | Per-project app usage by platform and store version, EAS Workflows run and success trends, and Maestro test trends ([docs.expo.dev](https://docs.expo.dev/eas-insights/introduction)), plus build and update usage breakdowns ([changelog](https://expo.dev/changelog/2024-12-19-project-level-usage)). | The best mobile "what are users running" view, but Expo-only. Mushi derives the version spread from SDK heartbeats on any stack and ties a version to the reports filed against it. |

**Where Mushi is weaker, said plainly:** no Figma, no hosting, no service catalog for many teams, no store API data in v1. **What none of them do:** join *what the app is made of* to *the bug a user just reported* and hand the agent a fix that respects both.

---

## Appendix B — glot.it pilot: format and placeholder example

glot.it's new design system is being designed in parallel (glot branch `design/art-direction`). The format below is final for v1. **The values in this appendix are placeholders**, taken from glot's currently shipped tokens (`design-system/tokens.ts`).

**Status, 2026-10-02.** The glot art-direction agent reports three candidate directions in this format, committed locally on glot `design/art-direction` (927bf34c9, not pushed):

- paths: `packages/design-tokens/tokens/directions/{pha-khram,soi-signpaint,nang-lamp}/{primitive,semantic,component}.tokens.json`;
- 255 tokens and 0 errors on that agent's validator, which checks dotted names, hex shorthand, unresolved aliases, layer direction and component ranges;
- `$extensions["us.kensaur.mushi"]` maps tokens to glot's existing CSS vars and TS names.

Those are deliberate values, not placeholders. Mushi's own `_shared/dtcg.ts` fixtures should include one of these files when Phase 1b is built.

**Latest, 2026-10-02:** the active direction changed to **soi-signpaint**, reported at glot `design/art-direction` 16335e6c1 with brand assets at 13f5130a6 (both local, not pushed). The shape below is as reported by the glot agent.

- **Directions:** all three are listed in `design.directions[]`, with soi-signpaint active and pha-khram and nang-lamp inactive. `design.tokens[]` lists only soi-signpaint as `source`, plus `dtcg/tokens.json` as `export`. The glot agent proposed the `directions[]` key.
- **CSS:** `app/styles/globals/theme-soi-signpaint.css` (`export`) declares two scopes: `html:root[data-direction="soi-signpaint"]` and `html.dark:root[data-direction="soi-signpaint"]`, the second being the night-street dark mode.
- **Dark-mode data:** semantic tokens carry `$extensions["us.kensaur.glot"].dark` and `contrastDark[]`, and the file root carries `colorScheme`. All of it is informational.
- **Shadow:** `shadow.shade` (`$type: shadow`, cssVar `--soi-shade`).
- **Literal scan:** `literalScan.globs` adds `design-system/primitives/street/**/*.tsx`; `design-system/directions/**` is ignored.
- **Assets:** `public/images/soi/signs`, `public/images/soi/mae-muang`, `store-assets/soi-signpaint`, plus the icon files.

**Earlier, 2026-10-02 (superseded):** **pha-khram** was the active direction, reported at glot `design/art-direction` 42a793c20 (local, not pushed). Its shape, as reported by that agent:

- **Root manifest:** a root `mushi.recipe.json` lists only `pha-khram/{primitive,semantic,component}.tokens.json` as `source`, plus `dtcg/tokens.json` as `export`.
- **Colour groups:** primitives are `color.palette.*`, `color.vat.*` and `color.tone-on-canvas.*`. Semantic roles are `color.{surface,text,action,feedback,line,dye,tone}.*`, plus `font`, `typography`, `space`, `radius`, `border` and `motion`. Component tokens alias semantic only.
- **Glot-only extension data:** sits under `$extensions["us.kensaur.glot"]` (`alsoSets`, `contrast[]`). Per §2, Mushi preserves it and does not interpret it.
- **Generated CSS:** `app/styles/globals/theme-pha-khram.css` is an `export`. Its variables live under `html:root[data-direction="pha-khram"]`, not `:root`, because the layer is scoped to migrated surfaces (glot's own ADR 0010). The manifest therefore declares that selector in `css[].scopes`.
- **Literal scan:** the generated `design-system/directions/pha-khram.ts` holds hex literals by design and is in `literalScan.ignore`. New code under `design-system/loom/**` is in `literalScan.globs`.

### B.1 Files

| File | Role |
|---|---|
| `mushi.recipe.json` (repo root) | The manifest |
| `packages/design-tokens/tokens/directions/<direction>/{primitive,semantic,component}.tokens.json` (new) | The **source**: hand-authored, conformant DTCG 2025.10 with nested groups and no dotted names. Each art-direction candidate gets its own folder. The manifest lists only the chosen direction. |
| `packages/design-tokens/dtcg/tokens.json` (today) | Stays an **export** until the new DS replaces the TypeScript source. After that, glot generates its TS, CSS and RN outputs *from* the source files, which is Mushi's own `brand.tokens.json → editorial.css` pattern. |

### B.2 `mushi.recipe.json` — PLACEHOLDER

```json
{
  "version": 1,
  "app": { "name": "glot.it", "kind": "app", "platforms": ["web", "android", "ios"], "ids": { "bundleId": "<ios bundle id>", "androidPackage": "<android package>" } },
  "links": {
    "domains": ["<glot web origin host>"],
    "deepLinks": { "schemes": ["<glot url scheme>"], "universalLinkDomains": ["<glot web origin host>"], "appLinks": [] },
    "auth": { "provider": "supabase", "ref": "<glot supabase ref>" },
    "notifications": { "slackChannel": "<channel id>" }
  },
  "design": {
    "tokens": [
      { "path": "packages/design-tokens/tokens/directions/<chosen>/primitive.tokens.json", "role": "source", "format": "dtcg-2025.10" },
      { "path": "packages/design-tokens/tokens/directions/<chosen>/semantic.tokens.json", "role": "source", "format": "dtcg-2025.10" },
      { "path": "packages/design-tokens/tokens/directions/<chosen>/component.tokens.json", "role": "source", "format": "dtcg-2025.10" },
      { "path": "packages/design-tokens/dtcg/tokens.json", "role": "export", "format": "dtcg-2025.10", "generator": "pnpm tokens:dtcg" }
    ],
    "css": [
      { "path": "packages/design-tokens/src/cross-platform-tokens.css", "role": "export" },
      { "path": "app/styles/globals/theme-<chosen>.css", "role": "export", "scopes": ["html:root[data-direction=\"<chosen>\"]", "html.dark:root[data-direction=\"<chosen>\"]"] }
    ],
    "directions": [
      { "name": "<chosen>", "status": "active", "tokens": ["packages/design-tokens/tokens/directions/<chosen>/primitive.tokens.json", "packages/design-tokens/tokens/directions/<chosen>/semantic.tokens.json", "packages/design-tokens/tokens/directions/<chosen>/component.tokens.json"] },
      { "name": "<other>", "status": "inactive", "tokens": ["packages/design-tokens/tokens/directions/<other>/primitive.tokens.json", "packages/design-tokens/tokens/directions/<other>/semantic.tokens.json", "packages/design-tokens/tokens/directions/<other>/component.tokens.json"], "note": "kept for comparison" }
    ],
    "components": { "globs": ["design-system/primitives/**/*.tsx", "packages/ui-mobile/src/**/*.tsx"] },
    "assets": [{ "path": "<icons dir>", "kind": "icon" }],
    "literalScan": { "globs": ["app/**/*.{ts,tsx,css}", "components/**/*.tsx", "features/**/*.tsx"], "ignore": ["**/*.test.*", "design-system/**"] }
  },
  "data": { "provider": "supabase", "projectRef": "<glot supabase ref>", "migrationsDir": "supabase/migrations" },
  "routes": { "inventory": "inventory.yaml" },
  "gates": {
    "budgets": { "bundle.web.total_kb": 900, "code_health.max_file_loc": 2000, "code_health.god_file_count": 0 },
    "cadence": { "code_health": "P1D" }
  },
  "ci": { "provider": "github-actions", "defaultBranch": "main", "workflows": { "ci.yml": { "role": "pr-gate" }, "deploy.yml": { "role": "deploy-web" }, "build-mobile-capacitor.yml": { "role": "build-mobile" } } },
  "deploy": {
    "targets": [
      { "id": "web-prod", "kind": "cloudfront-s3", "environment": "production", "url": "<glot web origin>", "probe": { "type": "version_json", "url": "<glot web origin>/version.json" }, "workflow": "deploy.yml", "maxLagHours": 24 },
      { "id": "android-play", "kind": "capacitor-android", "environment": "production", "probe": { "type": "sdk_heartbeat" }, "workflow": "build-mobile-capacitor.yml" },
      { "id": "ios-app-store", "kind": "capacitor-ios", "environment": "production", "probe": { "type": "sdk_heartbeat" } }
    ]
  },
  "env": {
    "environments": ["production"],
    "required": [
      { "name": "NEXT_PUBLIC_MUSHI_PROJECT_ID", "in": ["github-actions"], "environments": ["production"] },
      { "name": "NEXT_PUBLIC_MUSHI_API_KEY", "in": ["github-actions"], "environments": ["production"] },
      { "name": "NEXT_PUBLIC_SUPABASE_URL", "in": ["github-actions"], "environments": ["production"] }
    ],
    "example": ".env.example"
  },
  "integrations": { "sentry": { "project": "<glot sentry project slug>" }, "slack": {} },
  "change": { "allowPaths": ["mushi.recipe.json", "packages/design-tokens/tokens/**", "inventory.yaml", ".env.example"] }
}
```

### B.3 `semantic.tokens.json` excerpt — PLACEHOLDER values (current glot palette), final structure

```json
{
  "color": {
    "$type": "color",
    "surface": {
      "base":   { "$value": { "colorSpace": "srgb", "components": [0.9804, 0.9804, 0.9725], "hex": "#FAFAF8" }, "$description": "PLACEHOLDER — page background" },
      "raised": { "$value": { "colorSpace": "srgb", "components": [1, 1, 1], "hex": "#FFFFFF" } }
    },
    "text": {
      "primary": { "$value": { "colorSpace": "srgb", "components": [0.1765, 0.1059, 0.0549], "hex": "#2D1B0E" } },
      "onRaised": { "$value": "{color.text.primary}", "$description": "Text on raised cards; diverges from primary in dark-led directions" },
      "onRaisedSecondary": { "$value": { "colorSpace": "srgb", "components": [0.3529, 0.2471, 0.1686], "hex": "#5A3F2B" } }
    },
    "action": {
      "primary": {
        "$value": { "colorSpace": "srgb", "components": [0.9098, 0.2196, 0.498], "hex": "#E8387F" },
        "$extensions": { "us.kensaur.mushi": { "cssVar": "--color-cta", "ts": "colors.cta", "platforms": ["web", "rn"] } }
      },
      "accent": { "$value": { "colorSpace": "srgb", "components": [0.9412, 0.6784, 0.1804], "hex": "#F0AD2E" } }
    }
  },
  "space": {
    "$type": "dimension",
    "1": { "$value": { "value": 4, "unit": "px" } },
    "2": { "$value": { "value": 8, "unit": "px" } },
    "4": { "$value": { "value": 16, "unit": "px" } }
  },
  "radius": {
    "$type": "dimension",
    "control": { "$value": { "value": 12, "unit": "px" } },
    "card":    { "$value": { "value": 16, "unit": "px" } }
  },
  "motion": {
    "duration": { "$type": "duration", "quick": { "$value": { "value": 150, "unit": "ms" } }, "base": { "$value": { "value": 250, "unit": "ms" } } },
    "easing":   { "$type": "cubicBezier", "standard": { "$value": [0.2, 0, 0, 1] } }
  },
  "font": {
    "family": { "$type": "fontFamily", "body": { "$value": ["system-ui", "sans-serif"], "$description": "PLACEHOLDER — art direction pending" } },
    "weight": { "$type": "fontWeight", "regular": { "$value": 400 }, "bold": { "$value": 700 } }
  },
  "button": {
    "primary": {
      "background": { "$type": "color", "$value": "{color.action.primary}" },
      "radius":     { "$type": "dimension", "$value": "{radius.control}" }
    }
  }
}
```

**Authoring rules for glot's new design system (final):**

1. Nested groups only. No `.` in any name.
2. 2025.10 object values: `colorSpace` / `components` plus an optional `hex`; `{value, unit}` for dimensions and durations.
3. Aliases use `{group.token}`.
4. Mushi and platform metadata go only under `$extensions["us.kensaur.mushi"]`. The keys are `cssVar`, `ts`, `rn` and `platforms`, **each optional** (omit `rn` while a platform is parked). They give Mushi the token ↔ code-name map that the off-token literal scan and `get_design_tokens` use.
5. Text roles name the surface they sit on whenever that differs from the page background. Examples are `text.primary`, `text.secondary`, `text.onRaised`, `text.onRaisedSecondary` and `text.onAction`. A dark-led direction then keeps legible text on light cards without a component-level override. `$description: "PLACEHOLDER — …"` is used only for values that are genuinely undecided.
6. Assets (icons, key art, sprite sheets) are listed in `design.assets[]` with **repo paths** once a direction is chosen and committed. Never list a scratch or local-only location.
7. Component tokens alias semantic tokens, and semantic tokens alias primitives.
8. Every hand-authored file is `role: "source"`. Generated outputs are `role: "export"` and are never edited by a recipe PR.
