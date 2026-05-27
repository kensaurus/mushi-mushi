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
  - A2A push notification on failure

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

## Plan 005 — BYOK Settings UI (2026-05-14) `PLANNED`

### Goal
Let operators configure provider API keys (Firecrawl, Browserbase) from the
Settings page in the admin console, rather than needing to set Supabase
environment variables manually.

### Steps
1. `packages/server/supabase/migrations/YYYYMMDD_byok_keys.sql` — `byok_keys` table (project_id, provider_slug, encrypted_key, created_by)
2. `packages/server/supabase/functions/api/routes/settings-research.ts` — add GET/POST/DELETE `/v1/admin/projects/:id/byok-keys`
3. `apps/admin/src/pages/SettingsPage.tsx` — "API Keys" section with provider rows + key input
4. `_shared/byok.ts` — update `resolveLlmKey` to check `byok_keys` table by slug
5. `qa-story-runner` — update BYOK resolution to call `resolveLlmKey('firecrawl', projectId)` and `resolveLlmKey('browserbase', projectId)`

### Key design decisions
- Keys are encrypted at rest using `pgp_sym_encrypt` (requires `pgcrypto` extension).
- Only `service_role` reads the decrypted key — the UI never receives it.
- Provider slugs match the AGENTS.md BYOK table: `firecrawl`, `browserbase`, `openai`, `anthropic`.

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
