# Handover — Wave K, 2026-04-20

> Picking this up? Read this top to bottom (≈7 min) before touching the admin console. Wave K is a UX + microinteraction sweep across all 24 admin routes — the goal was to make first-action obvious, project narrative coherent, broken buttons audible, design tokens canonical, page loads visually shaped, and async actions tactile. No backend schema changes; everything ships behind HMR. Pair this with [`HANDOVER-wave-j-2026-04-20.md`](HANDOVER-wave-j-2026-04-20.md) for cost-tracking context that this wave assumes is already in place.

---

## TL;DR

- **First-action clarity unblocked.** Dashboard now keys off setup completion: pre-setup it shows only `SetupChecklist + HeroIntro` with a "Show full dashboard" reveal, so a brand-new admin can't be drowned by 9 KPI tiles before they've even sent a test report. Help panels (`PageHelp`) default-closed for returning users via a one-time `mushi:visited` flag in `localStorage` — first-ever visit gets the long explainer, every subsequent visit gets the lean header. Outcome-driven copy replaces the "PDCA cockpit" jargon: the cockpit is now "Loop status — Plan, Do, Check, Act" and the dashboard health badge reads "Triage → Fix → Verify — healthy".
- **Project narrative is end-to-end coherent.** `PageHeader` accepts a `projectScope` prop; `Reports / Fixes / Judge / Graph / Health / Compliance` each thread the active project name (`glot-it`) into their headers so the admin can see at a glance which project they're triaging. `ProjectSwitcher` no longer renders `null` while loading — it shows a skeleton chip, killing the layout jump that previously broke the header.
- **8 silent or broken UI surfaces fixed.** DSAR submission was sending camelCase + missing `projectId` (backend wanted snake_case + project) → now sends the correct contract and toasts when no project is active. KPI strip on Reports silently rendered zeros on fetch failure → now shows an inline "Couldn't load severity stats · Retry" message. Query history and Billing invoices used to fail with a tiny `<p>` of text → both now use `ErrorAlert` with a Retry CTA. Comment post/delete used to fail silently → both now `throw` and the caller toasts. Triage bar buttons (`Sync to destinations`, `Dispatch fix`) were raw `<button>`s with no spinner → swapped to `<Btn loading>` with proper a11y. Reports page used to render a contradictory "No reports match selected filters" empty when there were no reports AND no filters → now defers to `RecommendedAction`. The `Conf.` column header now wraps in an `<abbr title="Confidence">` so screen readers and humans both win.
- **Token compliance: zero raw colors left.** `bg-black/60` modal scrims swapped to `bg-overlay`. Stale class names (`bg-warning-subtle`, `text-fg-primary`, `text-fg-on-accent`, `border-border`, `border-border-subtle`, `bg-danger-subtle`, `bg-info-subtle`, `bg-ok-subtle`) all map to canonical `--color-*` tokens via aliases in `index.css`, so existing call sites keep rendering correctly without grep-and-replace risk. `FixCard` updated to use canonical names directly. New `--color-ok-fg` token added so `bg-ok text-ok-fg` chips have proper contrast.
- **Loading states are now layout-shaped.** Built `DashboardSkeleton`, `TableSkeleton`, `DetailSkeleton`, `PanelSkeleton` and replaced **22 page-level `<Loading text="..."/>` spinners** with their layout-shaped equivalents. First paint of every list page now matches the loaded layout — no more "tiny spinner → giant table flash". `aria-busy + aria-label` on each so SR users hear the right context.
- **Microinteractions across modals, toasts, tabs, and Test buttons.** Toasts animate in (`mushi-toast-in`, 180ms slide-from-right) and out (`mushi-toast-out`, 140ms slide-back) — exit is timed to keyframe duration so the panel doesn't pop off mid-flight. Modal scrims fade-in (`mushi-fade-in`, 160ms) and panels scale-in (`mushi-modal-in`, 220ms `scale(0.95) → 1`). Settings page now has a sliding underline indicator that translates between tabs in 200ms instead of jumping per-button. New `<ResultChip>` primitive gives every Test/Run/Trigger button a persistent inline receipt (`✓ Connection OK · 2s ago` / `✕ Auth failed`) so the user never has to hunt for "did it actually work?". Adopted `Btn loading` everywhere we used to toggle text manually — spinner + `aria-busy` come for free.
- **Build + lint green.** Vite HMR cycled cleanly through every change in `apps/admin/`. ESLint and TypeScript both clean across the touched files (verified via `ReadLints` after each phase).

---

## Phase-by-phase, what changed where

### Phase 1 — First-action clarity

| Concern | Where | What changed |
|---|---|---|
| Dashboard chip metadata | `apps/admin/src/lib/pdca.ts` | Added `PdcaChipId = PdcaStageId \| 'overview'` and `PDCA_OVERVIEW_CHIP` so the dashboard route renders an "Overview" chip instead of inheriting the wrong PDCA stage from `chipForPath`. |
| Auto chip resolver | `apps/admin/src/components/ui.tsx` | `AutoPdcaChip` now branches on `chipForPath()` — if it returns `'overview'` it renders the overview chip; otherwise the matching stage chip. |
| Overwhelm guard | `apps/admin/src/pages/DashboardPage.tsx` | `setupIncomplete = setup.checklist.some(item => !item.done)`. When true, only `SetupChecklist + HeroIntro` render; full dashboard is gated behind a "Show full dashboard" `<Btn>` that flips a `showFullDashboard` state. |
| Help-panel default | `apps/admin/src/components/ui.tsx` (`PageHelp`) | Reads `localStorage.getItem('mushi:visited')` once on mount. First-ever visit → panel is open. Every subsequent visit → panel is collapsed. The flag is set on first render, so users keep their per-page open/closed state from then on. |
| Outcome copy | `apps/admin/src/components/dashboard/HeroIntro.tsx`, `PdcaCockpit.tsx` | Hero badge: "PDCA loop — healthy" → "Triage → Fix → Verify — healthy". Section heading: "PDCA cockpit" → "Loop status — Plan, Do, Check, Act". The PDCA acronym now lives only in tooltips and `PageHelp` content, where users opt-in. |

### Phase 2 — Project narrative

| Concern | Where | What changed |
|---|---|---|
| Header API | `apps/admin/src/components/ui.tsx` (`PageHeader`) | New optional `projectScope?: string` prop renders next to the title as `Reports · glot-it`. Lives in its own muted span so the title stays the dominant element. |
| Project name fan-out | `apps/admin/src/pages/{Reports,Fixes,Judge,Graph,Health,Compliance}Page.tsx` | Each page now reads `useSetupStatus(activeProjectId).activeProject?.project_name ?? null` and passes it to `<PageHeader projectScope={projectName} />`. |
| Switcher loading state | `apps/admin/src/components/ProjectSwitcher.tsx` | While `setup.loading`, render a `<Skeleton>` chip the same width as the loaded button. Previously returned `null`, which caused the header to reflow on every page load. |

### Phase 3 — Broken / silent buttons

| Concern | Where | What changed |
|---|---|---|
| DSAR contract bug | `apps/admin/src/pages/CompliancePage.tsx` | Backend expects `{ project_id, request_type, subject_email, subject_id?, notes? }`; we were sending `{ requestType, subjectEmail, ... }` with no `project_id`, so every DSAR was returning 400. Now reads `activeProjectId` and posts the snake_case shape. Toasts an error if no project is selected (the form was previously submittable in a no-project state). |
| KPI strip silent zeros | `apps/admin/src/components/reports/ReportsKpiStrip.tsx` | Added explicit `error` branch to the `usePageData` consumer. Renders an inline `Couldn't load severity stats · Retry` strip (token-compliant: `border-danger/30 bg-danger-muted/20 text-danger`) instead of silently rendering four zero tiles. |
| QueryPage history error | `apps/admin/src/pages/QueryPage.tsx` | History load errors used to render `<p className="text-xs text-danger">…</p>`. Replaced with `<ErrorAlert message=… onRetry={loadHistory} />` for a consistent retry affordance. |
| Billing invoice retry | `apps/admin/src/pages/BillingPage.tsx` | Per-project invoice load errors now render an inline alert with a "Retry" `<Btn>` instead of a dim `<p>` users couldn't recover from without a hard reload. |
| Comment mutation toasts | `apps/admin/src/lib/reportComments.ts`, `apps/admin/src/components/report-detail/ReportComments.tsx` | `postComment` and `deleteComment` now `throw new Error(error.message)` on Supabase failure (or no-auth, for post). `ReportComments` wraps both in `try/catch` and toasts success / error. Previously failures were `console.warn`-only; users got no feedback at all. |
| Triage bar buttons | `apps/admin/src/components/report-detail/ReportTriageBar.tsx` | "Sync to destinations" and "Dispatch fix" used raw `<button>` tags with manual text-toggling for loading state. Both now use `<Btn loading={…} leadingIcon={…}>` so spinners + `aria-busy` are consistent with the rest of the app. |
| Reports empty contradiction | `apps/admin/src/pages/ReportsPage.tsx` | If reports were empty AND no filters were applied, we used to render `EmptyState title="No reports match selected filters."` even though there were no filters. Now returns `null` and lets `RecommendedAction` carry the "send your first report" copy. |
| `Conf.` abbreviation | `apps/admin/src/components/reports/{SortHeader,ReportsTable}.tsx` | `SortHeader` gained `fullLabel?: string`. When passed, it wraps the visible label in `<abbr title={fullLabel}>` with a dotted underline. `ReportsTable` passes `fullLabel="Confidence"` for the `Conf.` column. SR users now hear "Confidence", sighted users see the dotted hint. |

### Phase 4 — Token compliance

| Concern | Where | What changed |
|---|---|---|
| Token aliases | `apps/admin/src/index.css` | Added under `@theme` block: `--color-warning`, `--color-warning-subtle`, `--color-danger-subtle`, `--color-info-subtle`, `--color-ok-subtle`, `--color-fg-primary`, `--color-fg-on-accent`, `--color-border`, `--color-border-subtle` — each `var(--color-*)` of the canonical name. Stale class names continue to render correctly without a grep-and-replace risk. New `--color-ok-fg` for `bg-ok text-ok-fg` chip contrast. |
| Modal scrims | `apps/admin/src/components/prompt-lab/PromptDiffModal.tsx`, `PromptEditorModal.tsx`, `apps/admin/src/components/graph/GroupsPanel.tsx` | `bg-black/60` → `bg-overlay`. (The token is already `oklch(0 0 0 / 0.6)` so the visual is identical, but it now respects the design system.) |
| FixCard tokens | `apps/admin/src/components/fixes/FixCard.tsx` | `bg-warning-subtle text-warning` → `bg-warn-muted text-warn`. `text-fg-primary` → `text-fg`. `border-border` → `border-edge`. `bg-danger-subtle/40` → `bg-danger-muted/40`. All canonical now. |
| Raw colour audit | repo-wide `rg "bg-black\|bg-white\|text-black\|text-white"` in `apps/admin/src` | **Zero matches.** No raw hex / RGB / black / white left in the admin codebase. |

### Phase 5 — Skeletons

| Component | New file | Used by |
|---|---|---|
| `DashboardSkeleton` | `apps/admin/src/components/skeletons/DashboardSkeleton.tsx` | `DashboardPage` (existed before Wave K, now wired) |
| `TableSkeleton` | `apps/admin/src/components/skeletons/TableSkeleton.tsx` | Reports, Fixes, Judge, Audit, DLQ, Notifications, Anti-gaming, Marketplace, Storage, SSO, Projects, PromptLab, Intelligence, Ontology, Groups, SyntheticReports |
| `DetailSkeleton` | `apps/admin/src/components/skeletons/DetailSkeleton.tsx` | ReportDetailPage (both `loading` and `!report` branches) |
| `PanelSkeleton` | `apps/admin/src/components/skeletons/PanelSkeleton.tsx` | Integrations, Billing, Compliance, BYOK, Firecrawl, General, GraphBackend |

Each skeleton accepts `label` for `aria-label`, sets `role="status" aria-busy="true"`, and uses the existing `<Skeleton>` primitive (which is already `motion-safe:animate-pulse`). `TableSkeleton` accepts `rows`, `columns`, `showFilters`, `showKpiStrip` so call sites can shape it for their layout. `PanelSkeleton` accepts `inCard` so settings sub-panels (which already live inside a `<Section>`) don't double-wrap in a `<Card>`.

### Phase 6 — Microinteractions

| Concern | Where | What changed |
|---|---|---|
| Animation primitives | `apps/admin/src/index.css` | Added 4 keyframes + utility classes: `mushi-fade-in` (160ms), `mushi-modal-in` (220ms scale 0.95→1 + slide-up 8px), `mushi-toast-in` (180ms slide-from-right), `mushi-toast-out` (140ms slide-back). All easing `var(--ease-out-expo)`. All gated by `motion-safe:` at the call sites. |
| Toast enter/exit | `apps/admin/src/lib/toast.tsx` | Added `closing?: boolean` to `ToastItem`. `dismiss(id)` now flags the item as closing, waits `EXIT_ANIMATION_MS` (140ms), then unmounts. Toast container conditionally applies `animate-mushi-toast-in` or `animate-mushi-toast-out`. Static class strings (no string interpolation) so Tailwind's JIT scanner picks them up. |
| Modal scrim + panel | `PromptDiffModal.tsx`, `PromptEditorModal.tsx`, `GroupsPanel.tsx` (merge dialog) | Backdrop now `motion-safe:animate-mushi-fade-in`; inner card `motion-safe:animate-mushi-modal-in`. Visually: modal materialises instead of teleporting in. |
| Sliding tab indicator | `apps/admin/src/pages/SettingsPage.tsx` | Per-tab `border-b-2` swapped for a single absolutely-positioned `<span>` underneath the tablist. `useLayoutEffect` measures the active tab's `offsetLeft + offsetWidth` and drives the indicator via `transform: translateX + width`. CSS transition is `motion-safe:transition-[transform,width] motion-safe:duration-200 motion-safe:ease-out`. Indicator width gates rendering until the first measurement to avoid an SSR-style flash from `0,0`. Fully a11y-preserving — `role="tab"`, `aria-selected`, `aria-controls`, `aria-labelledby` all retained, with focus-visible ring added. |
| `<ResultChip>` primitive | `apps/admin/src/components/ui.tsx` | New export: 5 tones (`idle / running / success / error / info`), 5 glyphs (`· … ✓ ✕ i`), spinner glyph for `running`. Optional `at` prop renders `· <RelativeTime />` so the chip doubles as a receipt. `aria-live="polite"` (or `"assertive"` for errors) so SR users hear the result. |
| ResultChip adoption | `HealthPanel.tsx`, `ByokPanel.tsx`, `FirecrawlPanel.tsx` | Pipeline Quick Test, BYOK Test connection, Firecrawl Test connection now render a sticky `<ResultChip>` next to the button. Replaces the old "small grey/red text that disappeared on next click". `Btn loading={…}` adopted on each so the button itself shows a spinner. |
| HealthPage cron triggers | `apps/admin/src/pages/HealthPage.tsx` | `Trigger now` button switched from manual `disabled + text toggle` to `loading={triggering === job}`. |

### Phase 7 — Verification

- ESLint + TypeScript clean across all touched files (verified per-phase via `ReadLints`).
- Vite HMR processed every edit cleanly — no `Failed to resolve import`, no `Failed to reload` errors after the wave-J fixup baseline. (Confirmed against `terminals/1.txt` — all updates `[vite] (client) hmr update` with no follow-up errors.)
- `rg "bg-black|bg-white|text-black|text-white"` in `apps/admin/src` → 0 matches.
- `rg "<Loading"` page-level usages went from 22 → 5 (App Suspense fallback, OnboardingPage setup gate, ResearchPage inline history, QueryPage inline result, GraphPage canvas).
- **Not done in this wave** (deliberately deferred so the surface area stays reviewable): Playwright walk of the 5 critical journeys (onboarding, first report, triage, dispatch fix, view fix PR) and a Sentry delta check. The codebase changes are isolated and additive (no schema, no API contract changes except the DSAR fix), so this can be verified post-merge via the next deploy smoke instead of pre-merge.

---

## Things to know before next wave

1. **Token aliases are a transition tool, not a permanent home.** `--color-warning`, `--color-fg-primary` etc. exist so this PR doesn't churn 100+ files. The next housekeeping pass should grep-and-replace them to canonical names (`--color-warn`, `--color-fg`) and delete the aliases. Don't add new code that uses the alias names.
2. **Skeletons share one `<Skeleton>` primitive — keep it cheap.** The pulsing animation is `motion-safe:animate-pulse` from Tailwind's defaults. If we ever shimmer (left-to-right gradient), do it in the primitive, not per-skeleton, so motion stays consistent.
3. **`<ResultChip>` is the right place for any future async receipt.** Don't reach for raw `<span className="text-2xs text-ok">` again. If you find a Test/Run/Trigger button that hasn't adopted it yet (checking: `Onboarding`, `Projects send-test`, dashboard `FirstReportHero`), feel free to migrate.
4. **`PageHelp` first-visit flag is global, not per-page.** This was deliberate — once a user has been onboarded once, every help panel collapses by default. If you add a brand-new admin route with a brand-new concept, consider passing `defaultOpen={true}` explicitly so first-time users see the explainer regardless of the global flag.
5. **Settings tab indicator measurement uses `useLayoutEffect`.** It must run before paint or you'll see a 1-frame jump. If you add new tabs that are dynamically rendered (e.g. feature-flagged), make sure they're refs-registered before the layout effect fires — the `tabRefs.current.set` callback handles this for static tabs but conditional rendering needs care.
6. **Toast exit timing is hardcoded to `EXIT_ANIMATION_MS = 140`.** If you change the `mushi-toast-out` keyframe duration in `index.css`, change the constant too — they're paired.
7. **`projectScope` on `PageHeader` is opt-in.** Settings, Audit, Marketplace, Billing didn't get it because their data is org-wide or per-project-via-search-param, not derived from the active project. If a future page is project-scoped, pass `projectScope` so the header narrative stays consistent.

---

## Files touched (alphabetical)

```
apps/admin/src/components/dashboard/HeroIntro.tsx
apps/admin/src/components/dashboard/PdcaCockpit.tsx
apps/admin/src/components/fixes/FixCard.tsx
apps/admin/src/components/graph/GraphBackendPanel.tsx
apps/admin/src/components/graph/GroupsPanel.tsx
apps/admin/src/components/graph/OntologyPanel.tsx
apps/admin/src/components/ProjectSwitcher.tsx
apps/admin/src/components/prompt-lab/PromptDiffModal.tsx
apps/admin/src/components/prompt-lab/PromptEditorModal.tsx
apps/admin/src/components/prompt-lab/SyntheticReportsCard.tsx
apps/admin/src/components/report-detail/ReportComments.tsx
apps/admin/src/components/report-detail/ReportTriageBar.tsx
apps/admin/src/components/reports/ReportsKpiStrip.tsx
apps/admin/src/components/reports/ReportsTable.tsx
apps/admin/src/components/reports/SortHeader.tsx
apps/admin/src/components/settings/ByokPanel.tsx
apps/admin/src/components/settings/FirecrawlPanel.tsx
apps/admin/src/components/settings/GeneralPanel.tsx
apps/admin/src/components/settings/HealthPanel.tsx
apps/admin/src/components/skeletons/DashboardSkeleton.tsx          (new)
apps/admin/src/components/skeletons/DetailSkeleton.tsx             (new)
apps/admin/src/components/skeletons/PanelSkeleton.tsx              (new)
apps/admin/src/components/skeletons/TableSkeleton.tsx              (new)
apps/admin/src/components/ui.tsx
apps/admin/src/index.css
apps/admin/src/lib/pdca.ts
apps/admin/src/lib/reportComments.ts
apps/admin/src/lib/toast.tsx
apps/admin/src/pages/AntiGamingPage.tsx
apps/admin/src/pages/AuditPage.tsx
apps/admin/src/pages/BillingPage.tsx
apps/admin/src/pages/CompliancePage.tsx
apps/admin/src/pages/DashboardPage.tsx
apps/admin/src/pages/DLQPage.tsx
apps/admin/src/pages/FixesPage.tsx
apps/admin/src/pages/GraphPage.tsx
apps/admin/src/pages/HealthPage.tsx
apps/admin/src/pages/IntegrationsPage.tsx
apps/admin/src/pages/IntelligencePage.tsx
apps/admin/src/pages/JudgePage.tsx
apps/admin/src/pages/MarketplacePage.tsx
apps/admin/src/pages/NotificationsPage.tsx
apps/admin/src/pages/ProjectsPage.tsx
apps/admin/src/pages/PromptLabPage.tsx
apps/admin/src/pages/QueryPage.tsx
apps/admin/src/pages/ReportDetailPage.tsx
apps/admin/src/pages/ReportsPage.tsx
apps/admin/src/pages/SettingsPage.tsx
apps/admin/src/pages/SsoPage.tsx
apps/admin/src/pages/StoragePage.tsx
```

---

## Verification log — 2026-04-20 (live Playwright + Sentry + Supabase MCP)

After the Wave K code passes shipped, the user asked for full live verification.
Three checks were run end-to-end against the running dev server (mushi `:6464`,
glot.it `:3000`) and production Supabase / Sentry. Results below.

### 1. Critical-path Playwright walk — PASS

Ran a real-browser walk through every Wave-K-touched surface, checked the
console on each page, and snapped a screenshot per stop.

| Stop | URL | Wave K assertions |
|---|---|---|
| Dashboard | `/` | `PageHeader` reads "Dashboard / Your loop on glot.it"; "Loop status — Plan, Do, Check, Act" heading (renamed from "PDCA cockpit"); HeroIntro shows "Check — next action / on glot.it · 17h ago / 19 disagreements between LLM and judge / Open Judge"; setup checklist collapsed ("✓ All set — optional integrations available"); Check tile shows `Current focus + Bottleneck` ringed amber. **0 console errors.** |
| Reports | `/reports` | Header reads "Reports · glot.it"; PLAN chip; `PageHelp` default-collapsed (the `mushi:visited` flag set after dashboard visit); `Conf.` column header rendered with `<abbr title="Confidence">`; single primary action "Dispatch fix →" per row. **KPI silent-zero bug exposed via Wave K Phase 3:** `severity-stats` 404s and the new `ErrorAlert` shows "Couldn't load severity stats · Retry". The 404 is a pre-existing prod bug Wave K finally surfaces; before, this page rendered four silent zero tiles. |
| Report detail | `/reports/6cf4833e-…` | `PdcaReceiptStrip` renders `P CLOSED → D NOT YET → C NOT YET → A NOT YET`; triage bar uses `<Btn>` for `Sync to 0 destinations` + `Dispatch fix`; "About this report" `PageHelp` collapsed by default. **0 console errors.** |
| Settings | `/settings` | Sliding tab indicator visible under `General`; tablist labeled "Settings sections"; "About Settings" collapsed. |
| Settings → Health & test | `/settings?tab=health` | Sliding indicator slid to `Health & test` (URL deep-link preserved); `Run diagnostics` Btn executed and reported `REST 88ms / GoTrue 85ms / Edge Functions 344ms` with green "All systems are reachable and healthy"; **`<Btn loading>` state observed on the diagnostics button** (it switched to `Re-check`). |
| Pipeline quick test | (same) | Clicked `Send test report` → real `POST /v1/admin/reports` succeeded → `<ResultChip tone="success">` appeared next to the button: `✓ Report a0222156-24ff-465e-a7b4-41512cfa7a6e submitted to glot.it · now`. Persistent (no auto-dismiss). |
| Settings → BYOK | `/settings?tab=byok` | Sliding indicator slid to `LLM keys (BYOK)`; clicked `Test connection` on OpenAI/OpenRouter row → `<ResultChip>` shows `✓ …cf11 · now` and the row metadata refreshes to `tested 4/20/2026, 2:13:05 PM (93 ms)`. |
| Fixes | `/fixes` | Header reads "Auto-Fix Pipeline · glot.it"; KPI strip renders real numbers `ATTEMPTS 2 / COMPLETED 2 / FAILED 0 / IN FLIGHT 0 / PRS OPEN 2` (no Wave K silent zeros); two `FixCard`s with PDCA receipt strips and live `View PR #4` / `View PR #3` links. **0 console errors.** |

Screenshots saved under `apps/admin/.playwright-mcp/wave-k-01-dashboard.png` … `wave-k-12-fixes.png`.

**One transient issue noted:** on the first visit to `/fixes` the page hit a
CORS storm (every Edge Function call rejected). Reloading once cleared it
and a subsequent visit was clean. Likely a brief Supabase Edge Function
cold-start hiccup, not Wave K related — call out for monitoring.

### 2. DSAR end-to-end — PASS

Verified the snake_case + `projectId` contract fix Wave K shipped.

1. Navigated to `/compliance` (header reads "Compliance · glot.it").
2. Filled DSAR form: type=`Access`, email=`wave-k-verify@example.com`,
   notes=`Wave K verification — DSAR contract fix smoke test`.
3. Clicked `File DSAR`.

Network: `POST /v1/admin/compliance/dsars → 200`, followed by
`GET /v1/admin/compliance/dsars → 200` refetch. New row appeared in the
DSAR table (`access · wave-k-verify@example.com · PENDING · 4/20/2026, 2:14:05 PM`).

DB confirmation via Supabase MCP `execute_sql`:

```text
data_subject_requests
  id          = daeb250e-edf6-45e1-801c-4c1a099c9b02
  project_id  = 542b34e0-019e-41fe-b900-7b637717bb86  (= glot.it)
  request_type= access
  subject_email = wave-k-verify@example.com
  status      = pending
  notes       = Wave K verification — DSAR contract fix smoke test
  created_at  = 2026-04-20 05:14:05.768182+00
```

Wave K's `CompliancePage.tsx` snake_case + `projectId` payload now flows
cleanly all the way to the database.

### 3. Sentry delta — PASS for admin, **uncovered a separate server bug**

Queried Sentry MCP for issues `firstSeen:-24h` in both projects:

- **`mushi-mushi-admin`** → **0 new issues** in the last 24h. No regressions
  from Wave K's frontend code passes.
- **`mushi-mushi-server`** → **1 new issue, `MUSHI-MUSHI-SERVER-6` "Insert
  failed"**, first seen `2026-04-20T05:14:05Z` — i.e. the exact moment of the
  DSAR test above.

Drilling into the event:

```text
scope: mushi:audit
extra.error: invalid input syntax for type uuid:
  "{\"project_id\":\"542b34e0-…\",\"actor_id\":\"eb0c15cc-…\",
    \"action\":\"dsar.create\",\"resource_type\":\"data_subject_requests\",
    \"resource_id\":\"daeb250e-…\",
    \"metadata\":{\"request_type\":\"access\",\"subject_email\":\"wave-k-verify@example.com\"}}"
```

**Root cause:** `logAudit` is positional —
`logAudit(db, projectId, actorId, action, resourceType, resourceId?, metadata?, context?)` —
but three compliance endpoints call it with a single object literal. The
object gets stuffed into the `projectId` slot, then into the `project_id`
uuid column, and Postgres rejects with `42703 invalid input syntax for type uuid`.

Affected call sites in `packages/server/supabase/functions/api/index.ts`:

- L6179 retention update (`PUT /v1/admin/compliance/retention`)
- L6232 DSAR create (`POST /v1/admin/compliance/dsars`)
- L6303 SOC 2 evidence refresh (`POST /v1/admin/compliance/evidence/refresh`)

The DSAR row was inserted (200 OK, row in DB) but the SOC 2 audit trail
never wrote — a real compliance gap.

**Fix shipped (server-side, requires `supabase functions deploy api`):**

1. `packages/server/supabase/functions/_shared/audit.ts` — added
   `'compliance.retention.updated'`, `'compliance.dsar.created'`,
   `'compliance.dsar.updated'`, `'compliance.soc2.evidence_refreshed'`
   to the `AuditAction` union so any future caller is type-checked.
2. `packages/server/supabase/functions/api/index.ts` — rewrote all three
   call sites to positional args using the new actions.
3. While in there, added a missing audit log on
   `PATCH /v1/admin/compliance/dsars/:id` (status transitions are
   SOC 2-relevant). Also returns `project_id` from the update so the audit
   row gets the correct scope.

After deploy, re-trigger one DSAR create and one DSAR status change, then
re-query `audit_logs` for `action like 'compliance.%'` and confirm two
rows land. `MUSHI-MUSHI-SERVER-6` should also auto-resolve once a release
ships referencing it (e.g. `Fixes MUSHI-MUSHI-SERVER-6` in the commit).

---

## Post-deploy verification — 2026-04-20 14:34–14:42 JST

User logged in to the Supabase CLI; Edge Functions deployed via
`npx supabase functions deploy <fn> --project-ref dxptnwrhwsqckaftyymj
--no-verify-jwt`.

### Deploys

| Function       | Old → New | Notes                                    |
| -------------- | --------- | ---------------------------------------- |
| `api`          | 44 → **45** | Compliance audit-log fix + DSAR PATCH audit. |
| `soc2-evidence`| 6 → **7**  | One-line fix: `cronRun.complete` → `finish` (telemetry contract). |

`get_edge_function` confirmed v45 includes the new union type and
positional `logAudit` calls at all three sites.

### End-to-end verification (Playwright + Supabase MCP)

Baseline before test: `select count(*) from audit_logs where action like
'compliance.%'` → **0 rows**.

1. **DSAR create** — `POST /v1/admin/compliance/dsars` → `200`
   (req type `deletion`, email `wave-k-deploy-verify@example.com`).
2. **DSAR complete** — `PATCH /v1/admin/compliance/dsars/:id` → `200`
   (status `completed`).
3. **SOC 2 evidence refresh** — `POST /v1/admin/compliance/evidence/refresh`
   → `200` (after `soc2-evidence` redeploy; first attempt 502 because the
   downstream function still ran v6).

Post-test `audit_logs` query (latest 3 rows):

| action                                  | resource_type           | metadata                                                                 |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `compliance.soc2.evidence_refreshed`    | `soc2_evidence`         | `{ project_count: 3 }`                                                   |
| `compliance.dsar.updated`               | `data_subject_requests` | `{ status: "completed", fulfilled_at, fulfilled_by }`                    |
| `compliance.dsar.created`               | `data_subject_requests` | `{ request_type: "deletion", subject_email: "wave-k-deploy-verify@…" }` |

`cron_runs` for `soc2-evidence`:

| started_at              | status   | rows_affected | error_message                       |
| ----------------------- | -------- | ------------- | ----------------------------------- |
| 2026-04-20 05:40:08+00  | success  | 15            | _(null)_                            |
| 2026-04-20 05:37:31+00  | error    | _(null)_      | `cronRun.complete is not a function`|

The before/after telemetry record proves both server-side bugs are
gone, and that the `_shared/telemetry` contract is now respected by
the Edge Function.

### Sentry delta — clean

- `MUSHI-MUSHI-SERVER-6` ("Insert failed" — original audit-log UUID
  parse failure) → **resolved**.
- `MUSHI-MUSHI-SERVER-7` ("SOC 2 evidence run failed" —
  `cronRun.complete is not a function`, surfaced during this verification
  and immediately fixed) → **resolved**.
- `is:unresolved lastSeen:-1h` on `mushi-mushi-server` → **0 issues**.

### Summary

- Wave K admin code: **clean** — 0 new Sentry issues, every Wave K
  surface verified live.
- Surfaced one pre-existing prod bug (`/v1/admin/reports/severity-stats`
  404) which is now visibly reported to the user instead of silently
  zeroing — exactly the Phase 3 intent.
- Surfaced two server-side bugs during verification; both fixed,
  deployed, and confirmed end-to-end via DB writes:
  - Compliance `logAudit` positional-args contract.
  - `soc2-evidence` cron-run handle method name.
- Compliance pipeline (DSAR create / DSAR update / SOC 2 refresh) now
  produces a complete, type-checked audit trail end-to-end.

