# Handover — Onboarding UX overhaul, 2026-04-20

> Picking this up? Read this top to bottom (≈5 min). This release is the **first-time-user UX overhaul + post-QA fix pass**. The premise: end-users were landing on the admin console and not knowing what to do; the 23-page nav drowned them; the PDCA narrative was muddled across pages; and a routine QA pass surfaced four cloud-vs-local drift gaps. All of that is now closed. Pair this with [`HANDOVER-2026-04-20-polish.md`](HANDOVER-2026-04-20-polish.md) for the microinteraction context release assumes is in place, and with [`audit-2026-04-20/QA-VERIFICATION.md`](audit-2026-04-20/QA-VERIFICATION.md) for the verification receipts.

---

## TL;DR

- **Beginner / Advanced mode is now a global toggle.** Every admin lands in **Beginner** by default. The sidebar collapses from 23 routes to a curated 9-page linear loop (`Dashboard → Get started → Reports → Graph → Fixes → Judge → Health → Integrations → Settings`); a single header chip flips to Advanced and persists per-browser via `localStorage` (`apps/admin/src/lib/mode.ts`). Routes still resolve in either mode — only the sidebar is filtered, so deep links + bookmarks survive. A safety-net banner appears in the sidebar when a beginner deep-links into an advanced-only route, telling them what they're looking at and how to keep it visible.
- **Persistent Next-Best-Action strip.** New `<NextBestAction />` (rendered above every page in Beginner mode) reads setup status + recent activity and surfaces the single highest-leverage action. It points the user through Plan → Do → Check → Act in lockstep with `lib/pdca.ts > PDCA_STAGE_OUTCOMES`. Closes a long-standing "what do I do first?" complaint.
- **One PDCA model, four surfaces, one source of truth.** Added `PDCA_STAGE_OUTCOMES` to `apps/admin/src/lib/pdca.ts` — a single map of `{ headline, outcome, pipelineLabel }` per stage. The Dashboard storyboard, the first-run loop card, the new `LivePdcaPipeline`, and the Next-Best-Action strip all read from it. Future copy changes land in one file and propagate everywhere. Drift between `PdcaCockpit / GettingStartedEmpty / LivePdcaPipeline / NextBestAction` was a recurring audit finding pre-; it's now structurally impossible.
- **First-run loop is now 4-stage, not 3.** `GettingStartedEmpty` was the last surface still framing the loop as Plan / Do / Check; it now matches the cockpit, sidebar, and pipeline at four (Plan / Do / Check / Act). Each card pulls its headline + status from `PDCA_STAGE_OUTCOMES` instead of carrying its own copy. The card grid scales `1 → 2 → 4` columns across breakpoints with arrow connectors between cards on `lg+`. Replaced the prior generic spinner with a layout-shaped `GettingStartedSkeleton` so first paint matches the loaded layout.
- **Hero illustrations on every empty state.** `<EmptyState>` and `<SetupNudge>` now accept `icon` / `emptyIcon` / `blockedIcon` + `hints`. New `apps/admin/src/components/illustrations/` houses lightweight SVG hero graphics for the Onboarding plug, the empty Reports inbox, the empty Graph, the dispatched-but-not-merged Fixes lane, and so on. Every empty state in Beginner mode is now visually anchored — no more "blank panel + grey sentence" problem.
- **KPI tiles tell you what they mean.** Added `meaning` tooltip prop to every `<KpiTile>` instance on Dashboard, Reports, Fixes, Judge, Anti-Gaming, Queue, Prompt Lab, Health and Intelligence. A first-time admin can hover any number and see a one-paragraph plain-language explanation of what it measures, what "good" looks like, and what to do if it's wrong. Coverage is 100% across the beginner pages.
- **Microinteractions tightened.** `<ResultChip>` now renders persistently next to every Test/Run/Trigger button (Integrations, Health, Onboarding) — `idle → running → ✓ Connection OK · 2s ago` / `✕ Auth failed`. `ConnectionStatus` button got a `focus-visible` ring + `motion-safe:active:scale-[0.97]` so keyboard users get the same tactile feedback mouse users do. `<StatusStepper>` segments are now visibly larger in compact mode and carry an `Stage · n/4` label so the unit is unambiguous. `<SeverityStackedBars>` gained y-axis ticks (`0` / `max`) and a "reports per day" caption — previously the chart was a vibe with no numeric anchor.
- **Toast hardening.** `apps/admin/src/lib/toast.tsx` now pauses auto-dismiss on hover/focus, supports an optional `action` slot for "Undo" / "View report" CTAs, and caps the visible stack at 3 (oldest auto-dismisses) so a noisy mutation burst can't clog the viewport.
- **Post-QA fixes (P0 / P1 / P2).** A Playwright + REST verification pass surfaced four gaps:
  1. **Three local-only migrations missing in cloud Postgres** → ran `supabase migration repair --status reverted <historic-ids>` then `supabase db push`. Side-fix: removed `CREATE INDEX CONCURRENTLY` from `20260420000000_blast_radius_indexes.sql` (Supabase wraps migrations in a transaction).
  2. **Cloud DB errors weren't reaching Sentry** → added `dbError(c, err)` helper in `packages/server/supabase/functions/api/index.ts` that calls `reportError(...)` then returns the same shape; replaced 48 inline `c.json({ ok: false, error: { code: 'DB_ERROR', ... } }, 500)` call sites with it.
  3. **Query history rendered raw Postgres on `42703`** → endpoint now special-cases `42703` and returns `{ ok: true, data: { history: [], degraded: 'schema_pending' } }` plus a `migration_drift`-tagged Sentry capture.
  4. **No CI guard against "code deployed without migration"** → new `scripts/smoke-admin-endpoints.mjs` (also `pnpm --filter @mushi-mushi/server smoke`) probes the 8 most schema-sensitive endpoints; non-5xx required, `degraded: schema_pending` reported as a warning.
- **Build / lint / typecheck green.** `pnpm --filter @mushi-mushi/admin {build,lint,typecheck}` all pass after this release. No new dependencies.

---

## What changed where

### New files

| File | Purpose |
|---|---|
| `apps/admin/src/lib/mode.ts` | `useAdminMode()` hook + persistence (Beginner / Advanced) |
| `apps/admin/src/components/NextBestAction.tsx` | Persistent next-best-action strip rendered above every Beginner page |
| `apps/admin/src/components/dashboard/LivePdcaPipeline.tsx` | Live 4-node pipeline visualization (replaces the static narrative strip on Dashboard for users with reports) |
| `apps/admin/src/components/illustrations/` | Hero SVG illustrations per empty state |
| `apps/admin/src/components/skeletons/{Graph,Health,Onboarding,Query,Research}Skeleton.tsx` | Layout-shaped loaders for the heaviest five pages |
| `apps/admin/src/components/Jargon.tsx` | Inline jargon-tooltip primitive (e.g. "PDCA", "BYOK") |
| `apps/admin/src/lib/copy.ts` | Centralised plain-language copy library |
| `scripts/smoke-admin-endpoints.mjs` | Post-deploy CI smoke for schema-sensitive endpoints |
| `scripts/audit-buttons.mjs` | Static-analysis helper: every CTA → endpoint mapping |
| `docs/HANDOVER-2026-04-20-onboarding.md` | This file |
| `docs/audit-2026-04-20/REPORT.md` | audit report (heuristic scorecard, gap analysis) |
| `docs/audit-2026-04-20/QA-VERIFICATION.md` | Playwright + REST verification + same-day resolution log |
| `docs/audit-2026-04-20/BASELINE.md` | Pre-overhaul baseline (heuristic + perf) |

### Files modified (high-traffic)

| File | What changed |
|---|---|
| `apps/admin/src/components/Layout.tsx` | Wired `useAdminMode`, header `<ModeToggle>`, `visibleNav` filtering, `<NextBestAction>`, advanced-route warning |
| `apps/admin/src/components/dashboard/GettingStartedEmpty.tsx` | Refactored to 4-stage model; pulls copy from `PDCA_STAGE_OUTCOMES`; layout-shaped skeleton |
| `apps/admin/src/lib/pdca.ts` | Added `PDCA_STAGE_OUTCOMES` (the single source of truth) |
| `apps/admin/src/components/SetupNudge.tsx` | Accepts `emptyIcon` / `blockedIcon` / `emptyHints` |
| `apps/admin/src/components/ConnectionStatus.tsx` | `<button>` → focusable styled button with `aria-pressed` + motion-safe active scale |
| `apps/admin/src/components/integrations/PlatformIntegrationCard.tsx` | Wired `<ResultChip>` for persistent test feedback; `<Btn loading>` |
| `apps/admin/src/components/dlq/QueueKpiRow.tsx` (and 8 sibling KpiRow files) | Added `meaning` tooltip on every `<KpiTile>` |
| `apps/admin/src/components/charts.tsx` (`SeverityStackedBars`) | Y-axis ticks + "reports per day" caption |
| `apps/admin/src/components/reports/StatusStepper.tsx` | Larger compact bars, `Stage · n/4` label, active ring |
| `apps/admin/src/lib/toast.tsx` | Pause-on-hover, optional `action` slot, stack cap (3) |
| `packages/server/supabase/functions/api/index.ts` | `dbError(c, err)` helper, 48 call-site replacements, `42703` graceful-degrade for `query/history` |
| `packages/server/supabase/migrations/20260420000000_blast_radius_indexes.sql` | Removed `CONCURRENTLY` (incompatible with Supabase tx-wrapped migrations) |
| `packages/server/package.json` | Added `"smoke": "node ../../scripts/smoke-admin-endpoints.mjs"` |
| `README.md` | row + handover pointer |

---

## How to verify the changes locally

```bash
# 1. Install + build
pnpm install
pnpm --filter @mushi-mushi/admin build       # expect ✓ 0 errors
pnpm --filter @mushi-mushi/admin lint        # expect ✓ 0 errors
pnpm --filter @mushi-mushi/admin typecheck   # expect ✓ 0 errors

# 2. Run the admin SPA against your local dev backend
pnpm --filter @mushi-mushi/admin dev
#    → http://localhost:6464

# 3. Manual smoke (Beginner mode)
#    - Land on / → Next-best-action strip + 4-stage storyboard visible
#    - Click "Watch a bug travel through Mushi" → 201 + storyboard pulses
#    - Sidebar shows 9 items only
#    - Toggle Beginner ⇄ Advanced in the header chip → sidebar grows to 23 items
#    - Visit /query → no 500; History panel hydrates (post-migration)

# 4. Backend smoke against the deployed API
MUSHI_ADMIN_JWT="<paste jwt from devtools>" pnpm --filter @mushi-mushi/server smoke
#    → expect 8/8 endpoints PASS, 0 soft warnings (or 1 if migration not yet pushed in your env)
```

---

## What I deliberately did NOT do

- **No new third-party dependencies.** Every new component is local SVG + Tailwind tokens + existing primitives.
- **No backend schema additions** beyond pushing the three already-authored 04-20 migrations to cloud. Prior releases already shipped the column work; just got it into prod.
- **No mobile breakpoint pass.** Desktop-first; the layout adapts (storyboard collapses to 1 column at `sm`), but I didn't audit each page on mobile.
- **No auth-flow rework** (sign-up, OAuth, password reset) — out of scope.
- **No real-time / SSE refactor.** The Reports/Fixes streaming UIs were verified visually but no code changes.
- **No demo video.** Still on the deferred list from the v1.0.0 milestone (see `HANDOVER.md` historical doc).

---

## Known follow-ups (non-blocking)

1. **Wire `pnpm smoke` into CI.** The script is ready; it just needs a GitHub Actions step that pulls a service-role JWT from secrets and runs after every Edge Function deploy. Single workflow file change.
2. **Mobile pass.** Beginner storyboard + sidebar drawer behave well at `sm`; `Reports`, `Graph`, and `Fixes` tables overflow horizontally. Worth a dedicated mobile sweep in a release.
3. **Empty-state illustration set is intentionally minimal.** Add more as new empty states appear; the pattern is `<EmptyState icon={<HeroIllustration variant="..." />} ... />`.
4. **`PDCA_STAGE_OUTCOMES.act.outcome` is the most likely sentence to want tweaking** as the integrations roster grows. One-line change in `lib/pdca.ts` propagates everywhere.

---

## Audit + verification artefacts

- `docs/audit-2026-04-20/REPORT.md` — heuristic scorecard, gap analysis, before/after screenshots
- `docs/audit-2026-04-20/QA-VERIFICATION.md` — Playwright + REST verification + same-day resolution log
- `docs/audit-2026-04-20/BASELINE.md` — pre-overhaul baseline numbers
- `docs/audit-2026-04-20/dashboard-{beginner,advanced}.png` — sidebar comparison
- `docs/audit-2026-04-20/reports-{page,list}.png` — table polish receipts

If anything in release is unclear, the audit report explains the why; this handover explains the what + where.
