# ExecPlans — Mushi Mushi

> These plans follow the [OpenAI ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
> format: self-contained, numbered checklists that a coding AI can execute
> step by step without extra context. Each plan is versioned with a datestamp
> and a status (`COMPLETE | IN_PROGRESS | PLANNED`).

---

## Plan 001 — Headless SDK Widget (2026-05-14) `COMPLETE`

### Goal
Allow developers to attach the Mushi feedback reporter to any existing UI
element, rather than always injecting a fixed floating button.

### Deliverables
- [x] `packages/react/src/trigger.tsx` — `MushiTrigger<C>` (polymorphic) and `MushiAttach` (selector-based) components
- [x] `packages/react/src/index.ts` — re-exports both components
- [x] `packages/react-native/src/components/MushiTrigger.tsx` — RN cloneElement variant
- [x] `packages/react-native/src/index.ts` — re-exports `MushiTrigger`
- [x] `apps/admin/src/lib/sdkSnippets.ts` — `attachToSelector` config + per-trigger snippet generation
- [x] `apps/admin/src/components/SdkInstallCard.tsx` — 4-option trigger chooser + attach-selector input

### Key design decisions
- Headless components own zero UI. They wrap any element passed as children.
- `MushiTrigger<C extends ElementType>` accepts `as` prop so it can render as `<button>`, `<div>`, or any component.
- `MushiAttach` uses `useEffect` to wire click listeners. When `category` is specified it bypasses `sdk.attachTo()` (which only accepts `MushiWidgetConfig`) and uses `sdk.report({ category })` directly.

---

## Plan 002 — Multi-OS Console Fidelity (2026-05-14) `COMPLETE`

### Goal
Surface SDK platform and version data in the admin console so operators can
filter, group, and triage reports by platform (iOS, Android, Web, …).

### Deliverables
- [x] `apps/admin/src/components/reports/ReportsFilterBar.tsx` — Platform + SDK selects
- [x] `apps/admin/src/pages/ReportsPage.tsx` — `platform` + `sdkPackage` state + query params
- [x] `apps/admin/src/components/report-detail/types.ts` — `sdk_package`, `sdk_version`, `app_version`
- [x] `apps/admin/src/pages/ReportDetailPage.tsx` — Device & Build panel
- [x] `packages/server/supabase/migrations/20260514000000_qa_coverage.sql` — `qa_platform_rollup_24h` MV
- [x] `apps/admin/src/components/dashboard/PlatformHealthTile.tsx` — dashboard tile

### Key design decisions
- Platform data comes from `reports.environment->>'platform'` (already populated by all SDKs).
- `qa_platform_rollup_24h` MV aggregates by `(project_id, platform, sdk_package)` — refreshed hourly.
- Filter selects use native `<select>` (not `FilterSelect`) because they need `{ value, label }` pairs.

---

## Plan 003 — QA Coverage Suite (2026-05-14) `COMPLETE`

### Goal
Let users define automated user-story tests (NL prompts or Playwright scripts),
schedule them on cron, run them via pluggable browser providers, and see
pass/fail results on a dashboard tile and dedicated page.

### Phases

#### 3a — Schema
- [x] `qa_stories` table (id, project_id, name, prompt, script, script_lang, browser_provider, schedule_cron, enabled, byok_provider, user_story_node_id)
- [x] `qa_story_runs` table (id, story_id, project_id, status, latency_ms, started_at, finished_at, provider, provider_session_url, summary, assertion_failures, error_message, triggered_by)
- [x] `qa_story_evidence` table (id, run_id, artefact_type, artefact_url, artefact_text)
- [x] `qa_story_coverage_24h` MV (refreshes every 15 min)
- [x] `qa_platform_rollup_24h` MV (refreshes hourly)
- [x] RLS policies on all three tables
- [x] pg_cron: `qa-story-runner-tick` every minute

#### 3b — Browser Provider Abstraction
- [x] `packages/agents/src/browser/types.ts` — `BrowserProvider`, `QaStory`, `BrowserRunContext`, `EvidenceArtefact`, `AssertionFailure`
- [x] `packages/agents/src/browser/local-playwright.ts` — headless Chromium runner
- [x] `packages/agents/src/browser/browserbase.ts` — Browserbase REST API delegate
- [x] `packages/agents/src/browser/firecrawl-actions.ts` — Firecrawl Actions HTTP runner
- [x] `packages/agents/src/browser/index.ts` — `resolveBrowserProvider` factory

#### 3c — qa-story-runner Edge Function
- [x] `packages/server/supabase/functions/qa-story-runner/index.ts`
  - Cron-match gate (skips stories whose schedule doesn't align with current minute)
  - Rate-limit: 3 concurrent runs per project (`MAX_CONCURRENT_PER_PROJECT = 3`)
  - BYOK key resolution via `_shared/byok.ts`
  - Inline execution for `firecrawl_actions`
  - Browserbase REST delegation for `browserbase`
  - `status='skipped'` for `local` (operator CLI handles these)
  - Writes `qa_story_runs` + `qa_story_evidence`
  - ~~A2A push notification on failure~~ — **superseded**: QA failure notification
    routes through Slack Block Kit + `dispatchPluginEvent` (see `AGENTS.md`).
    The earlier A2A insert path was schema-mismatched and removed.

#### 3d — AI-Assisted Authoring
- [x] `test-gen-from-report` extended to write a `qa_stories` row after PR creation
  - Provider: `local` (CLI runner picks it up)
  - Schedule: `0 6 * * 1` (weekly Monday regressions)
  - Story name: `"Regression: <report summary>"`

#### 3e — Admin Console UI
- [x] `apps/admin/src/pages/QaCoveragePage.tsx` — story grid, pass-rate bar, create modal, story drawer
- [x] `apps/admin/src/components/dashboard/QaCoverageTile.tsx` — dashboard mini-tile
- [x] `apps/admin/src/components/Layout.tsx` — sidebar nav item under "Check"
- [x] `apps/admin/src/App.tsx` — `/qa-coverage` route
- [x] `packages/server/supabase/functions/api/routes/qa-coverage.ts` — REST CRUD endpoints
- [x] `packages/server/supabase/functions/api/index.ts` — route registration

### Key design decisions
- Edge functions cannot run local Chromium, so `local` stories are queued as
  `skipped` and consumed by an operator CLI tool.
- `firecrawl_actions` is the default — zero BYOK setup, works from Deno.
- Stories created via `test-gen-from-report` use `local` provider since they
  contain full Playwright TS which requires Node.

---

## Plan 004 — ExecPlans Documentation (2026-05-14) `COMPLETE`

### Goal
Establish machine-readable implementation documentation so any coding AI can
understand, resume, or extend the codebase without reading every file.

### Deliverables
- [x] `AGENTS.md` — agent inventory, QA Coverage lifecycle, BYOK keys table, "adding a new agent" guide
- [x] `docs/execplans/PLANS.md` — this file

---

## Plan 005 — BYOK Settings UI (2026-05-27) `COMPLETE`

### Goal
Let operators configure provider API keys (Firecrawl, Browserbase, OpenAI, Anthropic)
from the Settings page in the admin console, rather than needing to set Supabase
environment variables manually.

### Deliverables
- [x] `packages/server/supabase/migrations/20260527080000_byok_keys_unified_table.sql` — unified `byok_keys` table (project_id, provider_slug CHECK, key_ref, key_hint, timestamps, test_status)
- [x] `packages/server/supabase/migrations/20260527100000_browserbase_byok_extended_cols.sql` — Browserbase columns on `project_settings` (hint, timestamps, test_status, session_count)
- [x] `packages/server/supabase/functions/_shared/byok.ts` — `resolveLlmKey` updated: reads `byok_keys` table first, falls back to legacy `project_settings.byok_*_key_ref` columns, finally env var; `LlmProvider` union extended to include `firecrawl` + `browserbase`
- [x] `packages/server/supabase/functions/api/routes/settings-research.ts` — full `GET/PUT/DELETE/POST /v1/admin/byok/browserbase` quartet; `BYOK_PROVIDERS = ['anthropic','openai','firecrawl','browserbase']`
- [x] `packages/server/supabase/functions/api/routes/enterprise-integrations.ts` — Browserbase BYOK routes wired
- [x] `apps/admin/src/components/settings/BrowserbasePanel.tsx` — Dedicated Browserbase BYOK panel (configure key, test connection, clear, hint + timestamp display)
- [x] `apps/admin/src/components/settings/ByokPanel.tsx` — LLM-only panel (Anthropic + OpenAI) with base URL presets for OpenAI-compatible gateways
- [x] `apps/admin/src/pages/SettingsPage.tsx` — "Browserbase" tab added alongside existing "API Keys" and "Firecrawl" tabs
- [x] `packages/server/supabase/functions/qa-story-runner/index.ts` — BYOK key resolution now calls `resolveLlmKey` for firecrawl + browserbase with explicit provider whitelist

### Key design decisions
- Keys are stored via Supabase Vault (`vault_store_secret`); only `service_role` reads decrypted values — the UI never receives the raw key, only a masked hint.
- The `byok_keys` table is the canonical future store; existing routes write to legacy `project_settings.byok_*_key_ref` columns (still resolved by `resolveLlmKey` step 2) for backward compatibility until a data migration promotes rows.
- Provider slugs match AGENTS.md BYOK table: `firecrawl`, `browserbase`, `openai`, `anthropic`.

---

## Plan 006 — Code Review Fixes (2026-05-14) `COMPLETE`

### Goal
Address blocking issues found during the post-implementation code review.

### Deliverables
- [x] `packages/react/src/trigger.tsx` — `MushiAttach` now passes `category` to the click handler; bypasses `sdk.attachTo()` when category is set (since `attachTo` accepts `MushiWidgetConfig`, not `{ category }`)
- [x] `packages/server/supabase/functions/api/routes/qa-coverage.ts` — manual run endpoint returns `409` when the story is disabled; also fixes `.order('report_volume')` → `.order('reports_24h')` to match the actual MV column name (was causing 500 on `/platform-rollup`)
- [x] `packages/server/supabase/migrations/20260514000000_qa_coverage.sql` — `schedule_cron` default aligned to `'0 * * * *'` (hourly) to match the API route default
- [x] Live DB — `ALTER TABLE qa_stories ALTER COLUMN schedule_cron SET DEFAULT '0 * * * *'`
- [x] `packages/server/supabase/functions/api` — redeployed with both fixes

---

## Plan 007 — Synthetic Monitor Mutation UI (2026-05-27) `COMPLETE`

### Goal
Expose the `synthetic_monitor_allow_mutations` backend flag in the admin console so operators can opt individual projects into POST/PATCH/DELETE synthetic runs without editing the database directly.

### Deliverables
- [x] `apps/admin/src/components/inventory/CrawlerSettingsCard.tsx` — added `synthMutations` state, toggle row with warning copy ("Only enable for sandboxed environments"), disabled when `synthEnabled=false`, and included `synthetic_monitor_allow_mutations` in the PATCH body.

---

## Plan 008 — Fine-tune Adapter Coverage (2026-05-27) `COMPLETE`

### Goal
Research Anthropic and AWS Bedrock fine-tune APIs; implement available adapters and improve error messaging on unavailable stubs.

### Deliverables
- [x] Research: Anthropic fine-tune API not publicly self-service in 2026; Bedrock `CreateModelCustomizationJob` GA via SigV4.
- [x] `packages/server/supabase/functions/_shared/fine-tune-vendor.ts` — Anthropic stub improved with access link; Bedrock adapter implemented with minimal SigV4 signing, gated by `MUSHI_BEDROCK_FINETUNE_ENABLED=1`.
- [x] `apps/admin/src/components/prompt-lab/FineTuningJobsCard.tsx` — vendor/base-model select added to create modal (OpenAI default, Anthropic, Bedrock options).
- [x] Default `base_model` changed from `ANTHROPIC_SONNET` to `openai:gpt-4o-mini` in enterprise-integrations route.

---

## Plan 009 — OIDC SSO Self-service (2026-05-27) `COMPLETE`

### Goal
Ship OIDC SSO self-service flow (or improved manual-required handoff with correct schema).

### Deliverables
- [x] `packages/server/supabase/migrations/20260527060000_fix_sso_registration_status_check.sql` — extended CHECK constraint to include `manual_required`.
- [x] `packages/server/supabase/functions/api/routes/enterprise-integrations.ts` — OIDC handler updated to call GoTrue `/admin/custom-providers` for self-service where the API supports it; falls back to `manual_required` with YAML handoff config.
- [x] `apps/admin/src/pages/SsoPage.tsx` — OIDC form fields added (Client ID, Client Secret, Issuer URL); label updated from "audit-only" to "self-service".

---

## Plan 010 — Inventory v2 Gating Alignment (2026-05-27) `COMPLETE`

### Goal
Align inventory gating with the README ("Advanced mode" gate) and add a first-run walkthrough for empty state.

### Deliverables
- [x] `apps/admin/src/components/Layout.tsx` — `requiresAdvancedMode` flag added to `NavItem`; `visibleByFeature` checks it alongside `requiresFeature`; User stories nav item marked `requiresAdvancedMode: true`.
- [x] `apps/admin/src/pages/InventoryPage.tsx` — empty-state replaced with three-step "Set up Inventory v2" walkthrough (Connect repo → Paste/generate inventory.yaml → Enable synthetic monitor).

---

## Plan 011 — Multi-region Operator Helper (2026-05-27) `COMPLETE`

### Goal
Add Helm chart region awareness and operator documentation for multi-region deployments.

### Deliverables
- [x] `deploy/helm/values.yaml` — `global.region` and `global.peerRegions` values added.
- [x] `deploy/helm/templates/deployment-api.yaml` — `MUSHI_CLUSTER_REGION` and `MUSHI_PEER_REGIONS` env vars injected from global values.
- [x] `SELF_HOSTED.md` — "Running multi-region" section added with architecture overview, per-region chart deployment steps, DNS pattern, and logical replication instructions.
- [x] `docs/runbooks/region-routing-replication.md` — Created with full SQL `CREATE PUBLICATION` / `CREATE SUBSCRIPTION` snippets and verification steps.
- [x] `deploy/helm/README.md` — Multi-region "What is NOT in the chart" note replaced with active setup instructions.

---

## Plan 012 — Pending Changeset Polish (2026-05-27) `COMPLETE`

### Goal
Ship unit tests, CLI extract, CLI README updates, and framework adapter hooks from the CHANGELOG `pending` section.

### Deliverables
- [ ] `packages/web/src/lifecycle-hooks.test.ts` — **Not shipped as a dedicated file.** Hooks `beforeSendFeedback` / `onCrashedLastRun` exist in `packages/web/src/mushi.ts` and are listed in presets (`packages/core/src/presets.test.ts`); drop/modify/throw/timeout contract tests were never added.
- [x] `packages/web/src/rewards.test.ts` — `initRewards`, `updateRewardsUser`, `enqueue`, `flush`, `teardown` unit-tested.
- [x] `packages/cli/src/project-bootstrap.ts` — `mushi project create` logic (shipped as `project-bootstrap.ts`, not `project-create.ts`; wired from `packages/cli/src/commands/project.ts`).
- [ ] `packages/cli/src/project-create.test.ts` — **Not shipped.** No dedicated unit tests for `.env.local` / MCP merge / `saveConfig` at this path.
- [x] `packages/cli/README.md` — `mushi project create` and `mushi nudge` commands documented (synced Jul 2026 docs pass).
- [x] `packages/react/src/hooks.ts` — `usePulseTrigger`, `useBeforeSendFeedback`, `useOnCrashedLastRun` added.
- [x] `packages/vue/src/index.ts` — `usePulseTrigger`, `useOnCrashedLastRun` composables added.
- [x] `packages/svelte/src/index.ts` — `usePulseTrigger`, `useOnCrashedLastRun` added.
- [x] `packages/angular/src/index.ts` — `usePulseTrigger`, `useOnCrashedLastRun` added.

---

## Plan 013 — Bug-fix Bundle (2026-05-28) `COMPLETE`

### Goal
Harden six edge-case failure paths discovered during the May 27 code review.

### Deliverables
- [x] `packages/server/supabase/functions/api/routes/a2a-tasks.ts` — `.single()` → `.maybeSingle()` for report and fix-attempt lookups; explicit `NOT_FOUND` error returned instead of unhandled `null` de-ref.
- [x] `packages/server/supabase/functions/fix-worker/index.ts` — `skipUpdateErr` now converts to `failDispatch` so stalled jobs surface as `failed` rather than hanging in `dispatching` indefinitely.
- [x] `packages/server/supabase/functions/api/routes/published-apps.ts` — `slugFromName` regex hardened to collapse consecutive non-alphanum chars; `fallbackSlug` added so empty-name apps always get a valid slug.
- [x] `packages/server/supabase/functions/tremendous-redemption-worker/index.ts` — sentinel `tremendous_funding_source_id` check (`SKIP_SENTINEL`) prevents attempting live payout on placeholder config; failed orders stay `pending` for retry instead of moving to `failed`.
- [x] `packages/server/supabase/functions/qa-story-runner/index.ts` — unknown BYOK providers now log a warning instead of silently failing key lookup; explicit whitelist prevents future provider typos from bypassing resolution.
- [x] `packages/server/supabase/functions/api/helpers.ts` — `ingestReport` description normalisation guarantees result is ≥ 20 chars (schema minimum) by padding with spaces when the suffix alone doesn't reach threshold; fixes 1–9 char descriptions that would still fail zod validation after suffix.
- [x] `packages/core/src/queue.ts` — permanent error eviction from offline queue; HTTP_400, HTTP_422, INGEST_ERROR, VALIDATION_ERROR codes and matching message regex clear the entry so one bad report cannot block subsequent retries.
- [x] `packages/cli/src/index.ts` — `nudge` numeric-flag parser validates `minRating`, `maxRating`, `limit` are finite integers in valid ranges; clear validation error replaces silent NaN propagation.
- [x] `packages/capacitor/ios/MushiMushi/Sources/MushiMushi/Capture/BreadcrumbCollector.swift` — `maxMessageLength` floor changed from 50 → 1; removes the undocumented policy that silently promoted single-char messages to 50-char strings.

---

## Plan 014 — Multi-region + Apache AGE Documentation (2026-05-28) `COMPLETE`

### Goal
Document the already-implemented Apache AGE auto-detect and ship the missing
multi-region operator deliverables that Plan 011 marked complete prematurely.

### Deliverables
- [x] `deploy/helm/values.yaml` — `global.region` + `global.peerRegions` stub values with comments.
- [x] `deploy/helm/templates/deployment-api.yaml` — `MUSHI_CLUSTER_REGION` + `MUSHI_PEER_REGIONS` env vars injected from Helm values (conditional on non-empty).
- [x] `SELF_HOSTED.md` — "Running multi-region" section added (architecture, per-region `helm install` examples, DNS pattern, link to runbook).
- [x] `docs/runbooks/region-routing-replication.md` — Created with full `CREATE PUBLICATION` / `CREATE SUBSCRIPTION` SQL, replication lag query, Helm example, open-work callout for active/active write limitations.
- [x] `deploy/helm/README.md` — "What is NOT in the chart" note for multi-region replaced with "Multi-region deployment" instructions.
- [x] Apache AGE auto-detect: already implemented in `20260418001200_age_parallel_write.sql` via conditional `DO $$` block; no code change needed — documented in `deploy/helm/README.md` and confirmed via `grep`.

---

## Plan 015 — Code Health Console: Bundle Trends + Refactor Findings (2026-06-12) `COMPLETE` (verify checklist open)

> **Status note (Jul 2026):** Implementation checklist items above are marked
> done in-repo. The **Verification checklist** below remains open until remote
> migration / RLS / yen-yen CI push evidence is confirmed — do not treat those
> unchecked boxes as complete.

### Goal
Surface a host app's **bundle-size trends** and **god-file / refactor
recommendations** in the Mushi admin console, so an operator sees code-health
regressions on the same dashboard they already use for backend audits.

The trigger: the yen-yen refactor of `transactions.tsx`, `index.tsx`, and
`transaction/new.tsx` (each driven under a 2,000-LOC budget) produced exactly
the data this feature would track over time. Right now that signal lives only
in CI logs; this plan persists it and renders it.

### Design constraints / why it fits cleanly
- **No new storage primitive.** Bundle sizes are a time series → reuse the
  existing `metric_series` table. God-file findings are point-in-time lint-style
  violations → reuse the existing `gate_runs` + `gate_findings` tables with a new
  `code_health` gate value.
- **One new ingest surface.** A single `POST /v1/ingest/metrics` SDK/CI endpoint
  (API-key auth, mirrors the existing `POST /v1/ingest/spans` in
  `packages/server/supabase/functions/api/routes/public.ts`). It accepts both
  metric points and an optional `findings[]` array, so one CI call writes both
  targets atomically.
- **Push from CI, not a mushi-side scanner.** yen-yen already has
  `.github/workflows/bundle-budget.yml` which measures gzipped bundle KB. We add
  a step that POSTs sizes + a god-file LOC scan. Mushi never has to clone or
  build the host repo.
- **UI mirrors `FullStackAuditPage.tsx`** — same `PageHeader` / `Card` /
  `Badge` / `Section` primitives, same `apiFetch` + `useActiveProjectId` wiring,
  same severity-badge vocabulary.

### Data-model decisions (concrete)
**Metric names written to `metric_series` (`value` = `double precision`):**

| `metric_name`               | `dimension`             | meaning                                   |
|-----------------------------|-------------------------|-------------------------------------------|
| `bundle.mobile.gzip_kb`     | `ios` / `android` / `combined` | Hermes JS bundle, gzipped KB       |
| `bundle.web.gzip_kb`        | `combined`              | Next.js export JS chunks, gzipped KB      |
| `code_health.god_file_count`| `mobile` / `web`        | # files over the LOC budget               |
| `code_health.max_file_loc`  | `mobile` / `web`        | largest single source file LOC            |

`ts` is the CI run timestamp; `release_id` left null (CI is not release-scoped).

**Gate findings (`gate_runs.gate = 'code_health'`, one run per CI push):**
- `rule_id = 'god_file'` — one finding per file over budget. `file_path` =
  repo-relative path, `line` = the file's LOC (reused as a numeric carrier),
  `severity` = `error` when LOC > 2000, `warn` when LOC > 1500, else skipped.
  `message` = e.g. `"apps/mobile/app/(tabs)/transactions.tsx is 1905 LOC (budget 2000)"`.
  `suggested_fix` (jsonb) = `{ "hint": "extract cohesive hooks/components", "budget": 2000 }`.
- `rule_id = 'bundle_regression'` (optional) — `warn` finding when the gzipped
  delta vs the previous point exceeds the workflow's `*_BUDGET_DELTA_KB`.

### Deliverables

#### Phase 1 — Migration (mushi backend)
- [x] `packages/server/supabase/migrations/20260612061520_20260612140000_code_health_gate.sql`:
  - Extend `gate_runs_gate_check` to add `'code_health'`. **Re-list the full
    current set** so the constraint stays complete:
    `dead_handler, mock_leak, api_contract, crawl, status_claim, spec_drift,
    orphan_endpoint, unknown_call, schema_drift, code_health`
    (current set defined in `20260612010000_gate_types_v2_schema_snapshots.sql`).
  - No new tables, no new indexes (`metric_series` already has
    `idx_metric_series_project_metric` on `(project_id, metric_name, ts desc)`;
    `gate_findings` already has `idx_gate_findings_project_severity`).
  - `COMMENT ON CONSTRAINT` documenting the new gate.
  - `NOTIFY pgrst, 'reload schema';` at the end.
- [x] Apply via Supabase MCP `apply_migration` on the mushi project (resolve ref
  via `list_projects`; confirm once and reuse). Pre-check
  `SELECT DISTINCT gate FROM gate_runs;` returns no value outside the new set.
- [x] Verify post-apply: re-query the constraint via `pg_constraint`; insert a
  throwaway `gate_runs` row with `gate='code_health'` as `service_role` then
  delete it; run `get_advisors(security)` + `get_advisors(performance)` and
  confirm no new ERROR-level findings.

#### Phase 2 — Ingest endpoint + admin read (mushi backend)
- [x] `packages/server/supabase/functions/api/routes/public.ts` — add
  `app.post('/v1/ingest/metrics', apiKeyAuth, …)` directly beside the existing
  `/v1/ingest/spans` handler:
  - `projectId` comes from `c.get('projectId')` (set by `apiKeyAuth`).
  - Burst-cap via the existing `report_ingest_rate_limit_claim` RPC
    (`p_max_per_minute: 60`); rate-limit errors → `429` + `Retry-After`, other
    RPC errors logged non-fatally (same pattern as spans).
  - Body: `{ metrics?: MetricPoint[], findings?: CodeHealthFinding[] }` where
    `MetricPoint = { metric_name, dimension?, value, ts? }`.
    Validate with a Zod schema in `packages/server/supabase/functions/_shared/schemas.ts`
    (`codeHealthIngestSchema`) — cap `metrics` ≤ 50 and `findings` ≤ 200,
    enforce `metric_name` prefix allow-list (`bundle.` / `code_health.`),
    `value` finite, reject unknown top-level keys.
  - Insert metric points into `metric_series` (stamp `project_id`, default
    `ts = now()`).
  - If `findings.length`: insert one `gate_runs` row
    (`gate='code_health'`, `status` derived: `fail` if any `error`, else `warn`
    if any `warn`, else `pass`), then bulk-insert `gate_findings` with that
    `gate_run_id`. All writes use `getServiceClient()` (service role bypasses RLS).
  - Return `{ ok: true, data: { metrics_inserted, findings_inserted, gate_run_id } }`, `201`.
- [x] `packages/server/supabase/functions/api/routes/code-health.ts` (new, thin) —
  `registerCodeHealthRoutes(parent)` with:
  - `GET /v1/admin/code-health` (`requireAuth`, `requireProjectAccess`):
    reads `metric_series` for the `bundle.*` + `code_health.*` names (last 90
    days, ascending) and the **latest** `code_health` gate run's `gate_findings`,
    returns `{ trends: {...}, godFiles: [...], summary: { error_count, warn_count, max_loc, latest_bundle_kb } }`.
  - Register in `packages/server/supabase/functions/api/index.ts`
    (`import { registerCodeHealthRoutes }` + call it next to
    `registerFullstackAuditRoutes(app)`).
- [x] Deploy: `npx supabase functions deploy api --no-verify-jwt`. Verify with a
  real `curl` to `/v1/ingest/metrics` using a project API key (expect `201`) and
  `SET ROLE authenticated` read-back of the gate run.

#### Phase 3 — CodeHealthPage (mushi admin)
- [x] `apps/admin/src/pages/CodeHealthPage.tsx` — mirror `FullStackAuditPage.tsx`:
  - `useActiveProjectId()` + `apiFetch('/v1/admin/code-health?project_id=…')`.
  - **Bundle trend** section: small line/sparkline using the existing
    `apps/admin/src/components/charts/` primitives (`ChartFrame`), one series
    per `bundle.*` metric, with the current value + delta-vs-previous badge.
  - **God-files** section: `gate_findings` list reusing the `SeverityBadge`
    pattern; each row shows `file_path`, LOC (from `line`), severity, and the
    `suggested_fix.hint`. Empty state mirrors the audit page's "All clear".
  - `PageHelp` blurb explaining the data is pushed from the host repo's CI.
- [x] `apps/admin/src/App.tsx` — `const CodeHealthPage = lazy(() => import('./pages/CodeHealthPage').then(m => ({ default: m.CodeHealthPage })))` + `<Route path="/code-health" element={<CodeHealthPage />} />`.
- [x] `apps/admin/src/components/Layout.tsx` — add
  `{ label: 'Code Health', path: '/code-health', icon: IconGauge, beginner: false }`
  to the operate group, directly after the `Full-Stack Audit` entry.

#### Phase 4 — yen-yen CI push step
- [x] `scripts/scan-god-files.mjs` (yen-yen) — walks `apps/mobile/app`,
  `apps/mobile/components`, `apps/web` for `*.ts(x)` files, emits
  `{ findings: [...], metrics: [{ metric_name: 'code_health.god_file_count', dimension, value }, { metric_name: 'code_health.max_file_loc', dimension, value }] }`
  as JSON to stdout. Budget 2000 (error) / 1500 (warn). Pure Node, no deps.
- [x] `.github/workflows/bundle-budget.yml` — in the `web` and `mobile` jobs,
  after the existing `Measure …` step, add a **`Push code-health metrics`** step:
  - Guard: `if: github.event_name == 'push' && github.repository == 'kensa/yen-yen'`
    (skip PRs and forks so the secret never leaks and PR noise is avoided).
  - Builds the JSON payload (bundle KB from the `measure` step output + god-file
    scan) and `curl -sf -X POST "$MUSHI_API_URL/v1/ingest/metrics"` with header
    `X-Mushi-Api-Key: ${{ secrets.MUSHI_INGEST_KEY }}`; `|| echo "non-fatal"` so a
    mushi outage never fails the yen-yen build.
  - Add repo secrets `MUSHI_API_URL` + `MUSHI_INGEST_KEY` (a yen-yen project API
    key from the mushi console) — note this as a manual one-time setup step.
    **Secrets not yet added** — one-time manual step in the yen-yen GitHub repo settings.

### Verification checklist (full-stack ship discipline)
- [ ] Migration applied to the remote mushi project via MCP and the constraint
  verified by re-query (not assumed).
- [ ] `POST /v1/ingest/metrics` returns `201` for a valid API-key call and `429`
  on burst; an authenticated `GET /v1/admin/code-health` returns the same data
  the page renders (verified with `SET ROLE authenticated`).
- [ ] `gate_findings` for a `code_health` run are readable by the project owner
  and **not** by a non-member (RLS spot-check).
- [ ] `pnpm --filter @yen-yen/mobile typecheck` (script) + admin `tsc --noEmit`
  pass; `bundle-budget.yml` still green on a PR (push step skipped).
- [ ] `get_advisors` shows no new ERROR findings after the migration + deploy.
- [ ] One real CI push from yen-yen `main` lands rows in `metric_series` and a
  `code_health` gate run visible on `/code-health`.

### Acceptance criteria
A merge to yen-yen `main` records bundle KB + god-file counts, and the mushi
`/code-health` page shows the bundle trend line and the current god-file list
for the active project, with severity badges and refactor hints.

### Rollback
- Backend: the migration only widens a CHECK constraint and adds a route —
  revert by a follow-up migration restoring the prior constraint and removing
  the route registration; `metric_series` / `gate_findings` rows are inert.
- CI: delete the push step + secrets; bundle-budget behaviour is unchanged.

### Open decisions (resolve before Phase 1)
- **Endpoint name:** keep `/v1/ingest/metrics` (per the original take) carrying
  optional `findings[]`, vs. a more literal `/v1/ingest/code-health`. Default:
  keep `/v1/ingest/metrics` for one surface.
- **God-file scan scope:** mobile-only first, or include `apps/web` from day one.
  Default: include both (the scanner is trivial and web has its own budget job).
- [x] Mark `COMPLETE` and update `AGENTS.md` (note the new ingest surface) once shipped.

---

## Phase 3 — Quota Validation + Enterprise Gate + Sentry Upsell + Annual Billing

**Plan ID:** `gtm-phase3`
**Status:** In progress (Jun 2026)

### Purpose

Close the post-launch loop on the diagnoses-metered billing rollout from Phase 2:
- Validate that the included-diagnoses quotas (50 / 500 / 2,000) are correctly sized for real dogfooding projects.
- Enable the Enterprise tier gate on demand (SSO/audit/retention feature flags already exist).
- Layer the Sentry-enrichment upsell into the billing page.
- Add annual billing (≈2 months free) as optional Stripe prices.

### Phase 3a — Quota sizing validation (owner: kensaurus)

Run after at least 2 weeks of real usage with the shadow `diagnoses` ledger live.

**Steps:**

1. `mushi usage --json` on glot.it and yen-yen projects → record `diagnosesUsed` for the period.
2. Query Supabase: `SELECT project_id, SUM(quantity) FROM usage_events WHERE event_name='diagnoses' AND shadow IS NULL GROUP BY project_id ORDER BY 2 DESC;`
3. Compare against current tiers:
   - Free (50): typical dogfood project < 30 diagnoses/mo? Keep. Increase to 100 if feedback shows frequent free-wall hits.
   - Indie (500): typical individual developer project 100–300/mo? Keep.
   - Pro (2,000): team project? Validate.
4. If quotas are off by >2×, update `pricing_plans` rows via Supabase MCP and re-seed `stripe-bootstrap.mjs` with corrected `included_diagnoses_per_month` values.
5. Mark this step complete once two full billing cycles confirm quotas are correct.

### Phase 3b — Enterprise gate (on-demand)

The enterprise feature flags (`sso`, `audit_log`, `teams`) already exist in `pricing_plans.feature_flags`. No code changes required to activate — just:

1. A prospect asks for Enterprise → contact us form or email.
2. Ops creates a `billing_subscriptions` row with `plan_id = 'enterprise'` (manual or via Supabase dashboard).
3. The `entitlements.ts` gating already unlocks the SSO/audit routes when `plan.feature_flags.sso === true`.

**Do NOT build a self-serve Enterprise checkout until there are at least 3 Enterprise customers.** It creates compliance overhead (SOC 2 evidence, SAML setup) that should be done per-customer, not automated.

### Phase 3c — Sentry-enrichment upsell (shipped Jun 2026)

Added a `ContainedBlock` upsell in `BillingPage.tsx` overview tab — shown when `setup.getStep('sentry_connected')?.done` is false. Deeplinks to `/integrations`. No backend changes required.

### Phase 3d — Annual billing (backend prices shipped Jun 2026; console toggle not shipped)

`scripts/stripe-bootstrap.mjs` provisions annual Stripe prices:

- `mushi:indie:annual:v1` — $150/yr (≈$12.50/mo, 2 months free)
- `mushi:pro:annual:v1` — $490/yr (≈$40.83/mo, 2 months free)

Both `STRIPE_PRICE_INDIE_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` are output in the env block.
The billing API accepts `billing_interval: 'monthly' | 'annual'` on checkout start.

**Still open for console UX:**
1. Run `node scripts/stripe-bootstrap.mjs` to provision the prices (if not already).
2. Ensure `STRIPE_PRICE_INDIE_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` are in Supabase secrets.
3. `PlanComparisonTable` still hardcodes monthly copy — no monthly/annual toggle in the admin UI yet.
4. Do not document annual self-serve checkout as user-reachable until the toggle ships.

### Acceptance criteria

- [ ] Quota validation: 2-cycle data shows free-cloud < 50% of limit (no wall noise), indie < 80% (room for projects to breathe).
- [ ] Enterprise: one real customer onboarded via manual subscription row — confirms the gate works end-to-end.
- [ ] Sentry upsell: visible on billing overview when Sentry is not connected; hidden when it is.
- [ ] Annual billing: `stripe-bootstrap.mjs` creates prices without error; env lines printed.
