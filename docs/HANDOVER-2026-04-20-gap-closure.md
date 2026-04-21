# Handover — Gap closure, 2026-04-20

> Picking this up? Read this top to bottom (≈8 min) before touching code. This release closes the audit gap left by the PDCA cockpit reframing — and lands the last P0/P1/P2 findings from [`docs/audit-2026-04-19.md`](audit-2026-04-19.md). All 23 admin pages now carry the same loop-aware affordances: status progression, blast radius, KPI strips, NN/G empty states, and PDCA receipts.

---

## TL;DR

- **3 remaining P0s closed.** Reports group-collapse, status progression stepper, Report-detail PDCA receipt strip — all live, all consumed by the existing Reports / Report Detail pages without a redesign.
- **Real blast radius landed.** The `×N felt` column on `/reports` is now a real `COUNT(DISTINCT reporter_token_hash)` over the matching `report_group_id`, served by a Postgres RPC (`report_group_blast_radius`) backed by two partial covering indexes (`20260420000000_blast_radius_indexes.sql`). Falls back to `dedup_count` if the RPC fails.
- **Health page now has cost / p95 / last-failure** per function. The Edge function estimates cost on the fly via `LLM_PRICING_PER_M_TOKENS` since `llm_invocations` does not yet store `cost_usd`; revisit once we backfill that column.
- **Onboarding + dashboard polish** — `SetupChecklist` now collapses at 80% completion *or* required-done, and the active step gets a brand ring + "Do this next" chip. The dashboard surfaces a `FirstReportHero` the moment the SDK is installed but no report has landed.
- **14 per-stage polish items shipped** — `PdcaBottleneckPill` per project, billing usage forecast, `actor_type` audit filter, compliance Export PDF (`window.print()` + `@media print`), per-project storage usage, Saved-queries sidebar + SQL hints card, segmented status filter on Fixes, prompt-vs-baseline strip, judge `Run now` weighted to primary, intelligence weekly-narrative strip, research history filters, integrations "what you can do" lists, notifications NN/G empty states.
- **`EmptyState` primitive is now NN/G-compliant** — `title` + `description` + optional `hints` bullet list + `action` + `icon`. Used everywhere instead of bespoke "no results" cards.
- **Build + lint green.** `apps/admin` typecheck and ESLint both pass.

---

## Phase-by-phase, what changed where

### Phase 1 — Backend foundation

| Concern | Where | What changed |
|---|---|---|
| Real blast radius | `packages/server/supabase/functions/api/index.ts` (`/v1/admin/reports`) | Calls new `report_group_blast_radius(group_ids uuid[])` RPC, joins the result into the per-row enrichment map as `unique_users` and `unique_sessions`. Dedup count fallback preserved when RPC errors. |
| Indexes | `packages/server/supabase/migrations/20260420000000_blast_radius_indexes.sql` | `create index concurrently … on reports (report_group_id, reporter_token_hash) where report_group_id is not null` + matching session index, both partial. RPC body lives in the same migration. |
| Per-function health rollup | `/v1/admin/health/llm` | Now returns `p95LatencyMs`, `costUsd`, `lastFailureAt` per function. Cost is *estimated* on the fly using `LLM_PRICING_PER_M_TOKENS` × token counts since `llm_invocations.cost_usd` is not yet a real column — revisit when ships the column. |
| Severity strip API | New `/v1/admin/reports/severity-stats` | 14-day severity rollup (count per severity + 7-day delta) for the Reports KPI strip. |
| Report detail prefetch | `/v1/admin/reports/:id` | Pre-fetches related `llm_invocations`, `fix_attempts`, and `classification_evaluations` in parallel so the new `PdcaReceiptStrip` renders without N+1. |
| Project bottleneck | `/v1/admin/projects` | Each project row carries `pdca_bottleneck` + `pdca_bottleneck_label`, computed from `reports` (Plan), `fix_attempts` (Do), and `classification_evaluations` (Check). |
| Audit actor type | `/v1/admin/audit?actor_type=human\|agent\|system` | Heuristics on `actor_id` / `actor_email` patterns (`agent_*` / `cron_*` / `webhook_*` / `null` → system). |
| Storage usage | New `/v1/admin/storage/usage` | Per-project screenshot object count + last write timestamp, sourced from the `reports` table (`screenshot_path is not null`). |
| Saved queries | New `PATCH /v1/admin/query/history/:id` + `GET /v1/admin/query/history?saved=1` | Toggles a new `is_saved` boolean column on `nl_query_history`. Migration: `20260420000100_nl_query_saved.sql` (with a partial index on `(user_id, created_at desc) where is_saved`). |

### Phase 2 — Reports lifecycle

- `apps/admin/src/components/reports/StatusStepper.tsx` — new 4-segment stepper (`new → classified → fixing → fixed`). Active segment severity-toned, completed segments `ok-muted`, future segments `border-edge-subtle`. Hover surfaces the timestamp when each status was reached.
- `apps/admin/src/components/reports/ReportRowView.tsx` — replaced single `<Badge>` with `<StatusStepper />`; blast-radius column now reads from `row.unique_users ?? row.dedup_count`.
- `apps/admin/src/components/reports/ReportsTable.tsx` — group-by-fingerprint collapse on by default (`?group=fingerprint`). Multi-row groups render a canonical row + `+N variants` chip with an expand chevron; expand state lives in `?expand=<groupId>` so deep links restore.
- `apps/admin/src/components/reports/ReportsKpiStrip.tsx` — new 4-tile KPI strip (`Critical / High / Medium / Low`, 14d window with 7d delta) backed by the new `/severity-stats` endpoint. Each tile filters the table on click.
- `apps/admin/src/pages/ReportsPage.tsx` — wires the strip + group state. Filtered empty state now follows NN/G (status + learning cue + "Clear filters" action).

### Phase 3 — Report detail PDCA receipt

- `apps/admin/src/components/report-detail/PdcaReceiptStrip.tsx` — compact 4-stamp strip, no per-stage subtitle. Stages map to `Plan = received + classified`, `Do = fix dispatched`, `Check = judge scored`, `Act = PR merged`.
- `apps/admin/src/pages/ReportDetailPage.tsx` — strip rendered immediately under `PageHeader`. Uses the prefetched arrays from `/v1/admin/reports/:id` so no extra round-trip.
- `apps/admin/src/components/report-detail/ReportClassification.tsx` — screenshot promoted to a `ScreenshotHero` (`w-full max-h-96 object-cover`) at the top of the page so triage starts from the visual.

### Phase 4 — Onboarding + dashboard polish

- `apps/admin/src/components/SetupChecklist.tsx` — `current?: boolean` prop on `ChecklistCard`; the next-incomplete-required step gets `ring-2 ring-brand` + a "Do this next" chip. Banner now collapses on `requiredDone || percentComplete >= 0.8`.
- `apps/admin/src/pages/OnboardingPage.tsx` — `current` prop wired in; "Send test report" card promoted above the checklist whenever `api_key_generated` is done but `first_report_received` is not.
- `apps/admin/src/components/dashboard/FirstReportHero.tsx` — new dedicated CTA shown when the SDK is installed but no report has landed (driven by `useSetupStatus`). The legacy `GettingStartedEmpty` no longer carried this CTA because of its own gating logic, so `FirstReportHero` exists alongside it instead of inside it.
- `apps/admin/src/pages/DashboardPage.tsx` — renders `FirstReportHero` between `PdcaCockpit` and the KPI row when conditions match.
- `apps/admin/src/components/dashboard/QuickFiltersCard.tsx` — **deleted**. The Reports KPI strip + page-level filters cover the use case; the dashboard placement was noise, confirmed dashboard-only via grep.

### Phase 5 — Per-stage polish (Plan / Do / Check / Act / Workspace)

| Page | File | Change |
|---|---|---|
| `/queue` | `DLQPage.tsx` + `dlq/QueueItemCard.tsx` | "Recover stranded" promoted to `variant="primary"` + `IconRefresh`. Queue item card shows `Waiting Xm` for queued / in-progress items. |
| `/anti-gaming` | `AntiGamingPage.tsx` | Each KPI tile carries a `today vs 7d avg` delta computed client-side from device + event timestamps. PageHelp now name-drops the loop role. |
| `/graph` | `graph/GraphStoryboard.tsx` | Column header now reads "*N components — most affected `<CommandPalette/>`*" instead of the raw type name. Inline edge-weight legend chip ("thicker = more bugs touching both"). |
| `/fixes` | `FixesPage.tsx` | Segmented status filter (`All · In flight · PR open · Merged · Failed`) above the cards, `role="radiogroup"`. |
| `/prompt-lab` | `prompt-lab/PromptDiffModal.tsx` | "Performance vs baseline" 2-cell strip pulls `total_evaluations` + `avg_judge_score` instead of token cost (cost is not yet stored — see Phase 1 note above). |
| `/judge` | `JudgePage.tsx` | "Run judge now" weighted to `variant="primary"` + `IconPlay`. `judge_reasoning` truncated as a row caption when `classification_agreed === false`. |
| `/health` | `HealthPage.tsx` | Per-function row now renders `$ cost · p95 ms · last failure RelativeTime`. |
| `/intelligence` | `IntelligencePage.tsx` | Top weekly-narrative strip rendered from the latest report's `summary`, NN/G empty state with "Generate now" otherwise. |
| `/research` | `ResearchPage.tsx` | Client-side `mode` (web / docs) and `since` (24h / 7d / all) filters above the sessions table. |
| `/integrations` | `integrations/PlatformIntegrationCard.tsx` + `RoutingProviderCard.tsx` + `types.ts` | New `capabilitiesOnceConnected: string[]` field on every `PlatformDef` and `RoutingProviderDef`. Rendered as a tight bullet list under `whyItMatters` when not yet connected. |
| `/notifications` | `NotificationsPage.tsx` | Filtered empty state gets a "Clear filters" button; no-notifications-yet state links to `/integrations`. |
| `/projects` | `ProjectsPage.tsx` | New `PdcaBottleneckPill` per project card (Plan / Do / Check / Act tone) labelled with the most-urgent stalled stage and deep-linking to that page. |
| `/billing` | `BillingPage.tsx` | New `buildUsageForecast` band under each report-usage bar — "on pace to hit limit on {date} ({n}d away)" with `danger / warn / muted` tones. |
| `/audit` | `AuditPage.tsx` | New `actor_type` filter dropdown (Any / Human / Agent / System); plumbs through to the API param. |
| `/compliance` | `CompliancePage.tsx` + `index.css` | New "Export PDF" button calls `window.print()`; global `@media print` rules in `index.css` hide the app shell, expand link `href`s, and `break-inside: avoid` on cards/tables. |
| `/storage` | `StoragePage.tsx` | Per-project usage table (object count + last write) above the provider cards, sourced from the new `/v1/admin/storage/usage` endpoint. |
| `/query` | `QueryPage.tsx` | Saved-queries sidebar (pin a question with `★`), refactored `HistoryItem` row component (rerun / unpin / delete), new SQL hints card with seed prompts. |

### Phase 6 — Microcopy + README sync

- `apps/admin/src/components/ui.tsx` — `EmptyState` primitive extended: `hints?: string[]` (bullet list of learning cues) + `icon?: ReactNode`. Description gets `max-w-prose mx-auto leading-relaxed` so long copy reads cleanly.
- `apps/admin/README.md` — Pages table updated for `/reports`, `/reports/:id`, `/onboarding`, `/projects`, `/billing`, `/audit`, `/storage`, `/compliance`, `/integrations`, `/graph`, `/query`. New endpoints section updated with the 8 new/extended endpoints. Dashboard composition section updated for `FirstReportHero` and the retired `QuickFiltersCard`. UI primitives section re-points `EmptyState` to the new shape.
- Root `README.md` — added a "gap-closure (Apr 2026)" paragraph under the existing "PDCA cockpit reframing" paragraph linking back to this handover.
- This document is the per-handover delta — the handover (`HANDOVER-2026-04-18.md`) remains the source of truth for everything that landed before.

---

## Verification

- `pnpm --filter @mushi-mushi/admin typecheck` → green (`tsc --noEmit`, no errors)
- `pnpm --filter @mushi-mushi/admin lint` → green (`eslint src/`, no errors)
- Migrations: `20260420000000_blast_radius_indexes.sql` and `20260420000100_nl_query_saved.sql` — both `IF NOT EXISTS` / `CONCURRENTLY` so they're safe to re-run.

---

## Known gaps / what's next

1. **`llm_invocations.cost_usd` column.** Currently estimated on the fly via `LLM_PRICING_PER_M_TOKENS`. Once we add the column + a migration to backfill, swap the Health rollup over and surface real cost on `/prompt-lab` instead of the "performance vs baseline" proxy.
2. **Materialised view for `report_groups` aggregates.** Only worth it if the per-request `COUNT(DISTINCT)` p95 climbs above 250 ms. Not warranted at current scale per Citus's benchmarks.
3. **Server-side PDF rendering for `/compliance`.** v1 uses `@media print`; revisit if customers ask for branded headers / multi-page layouts.
4. **Visual regression baselines.** No after-screenshots were captured into `audit-after-wave-i/` in this pass — recommended next time someone opens the project locally with `pnpm dev`.
5. **Sentry / Langfuse smoke check.** The verification step in the plan says "Sentry MCP scan + Langfuse trace confirmation"; defer to the next person who can run the full dogfood loop end-to-end.

---

## Where to look first if something breaks

- Reports page renders nothing → check `report_group_blast_radius` RPC exists (migration applied?). The handler logs `[admin/reports] blast_radius_failed` and falls back to `dedup_count` so the page should still load even if the RPC is missing.
- Health page shows `$0` everywhere → `LLM_PRICING_PER_M_TOKENS` doesn't have an entry for the model name being recorded. Add the model to the map in `api/index.ts`.
- Saved queries don't toggle → `nl_query_history.is_saved` column missing (migration not applied). API returns `DB_ERROR`.
- Compliance Export PDF prints the sidebar → `@media print` rules in `index.css` not loaded. Confirm `index.css` is the active stylesheet for the page.
- `PdcaBottleneckPill` always missing → `/v1/admin/projects` returning the old shape. Check the bottleneck thresholds in the API (`doFailed > 0`, `planCount > 5`, etc.) and confirm `fix_attempts.project_id` is populated.
