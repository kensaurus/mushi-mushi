# MushiMushi Admin Console — UX Audit Baseline (2026-04-20)

> Pre-overhaul snapshot. Phase 0 of the [`mushi-mushi-ux-overhaul`](../../.cursor/plans/mushi-mushi-ux-overhaul_0fa950a3.plan.md) plan.
> Compare to `REPORT.md` (Phase 8 deliverable) for before/after deltas.

---

## Servers verified

| Service | URL | Status |
|---|---|---|
| Mushi Mushi admin | http://localhost:6464/ | 200 |
| Glot.it (dogfood target) | http://localhost:3000/ | running on `/glot-it/` |

---

## Pre-overhaul gap inventory (sourced from `apps/admin/src` exploration)

### A. Mental-model inconsistency

| # | Issue | Source of truth | Affected files |
|---|---|---|---|
| A1 | **3-stage vs 4-stage PDCA** — first-run uses 3 (Plan/Do/Check), cockpit + sidebar use 4 (Plan/Do/Check/Act) | `lib/pdca.ts` | `components/dashboard/GettingStartedEmpty.tsx` |
| A2 | No global Beginner / Advanced mode — all 23 routes always visible | — | `components/Layout.tsx` |
| A3 | "Next best action" only on Dashboard, not propagated to other pages | — | `components/RecommendedAction` (used per-page, not global) |

### B. Jargon density

`PageHelp`, badges, and inline copy lean on internal vocabulary that a brand-new user can't decode:

`triage`, `dispatch`, `BYOK`, `Vault`, `pipeline`, `fast-filter`, `classify-report`, `judge-batch`, `dead-letter`, `anti-gaming`, `fingerprint`, `dedup`, `air-gap`, `reporter_token_hash`, `confidence`, `prompt-cached`.

### C. Loading state gaps (page-level spinners that should be layout-shaped skeletons)

| Page | Current | Target |
|---|---|---|
| `/graph` | `<Loading text="Loading graph…" />` | `GraphSkeleton` (sidebar + canvas + table) |
| `/health` | `<Loading text="Loading health metrics..." />` | `HealthSkeleton` (KPI strip + 4 cards) |
| `/onboarding` | full-page `<Loading />` | `OnboardingSkeleton` (narrative + checklist) |
| `/query` | inline `<Loading />` for query gen + history | `QuerySkeleton` |
| `/research` | inline `<Loading />` | `ResearchSkeleton` |
| dashboard `GettingStartedEmpty` | `<Loading text="..." />` | inline skeleton |

### D. Microinteraction gaps

| Element | Gap | Where |
|---|---|---|
| Toast dismiss | No `focus-visible` ring, no pause-on-hover, no action slot, no stack limit | `lib/toast.tsx` |
| Raw `<button>` (not `<Btn>`) | Inconsistent focus/hover/loading | `pages/LoginPage.tsx`, `pages/OnboardingPage.tsx`, `components/ConnectionStatus.tsx` |
| Test/Run/Trigger buttons | Some have `ResultChip`, many do not | BYOK Test, Firecrawl Test, Health Run-now, Pipeline Test, Storage Test, Integrations Test (Sentry/Langfuse/GitHub/Routing), SSO Test, Marketplace Dispatch |
| Press feedback | `motion-safe:active:scale-[0.97]` is on `Btn` but no ripple/pulse on primary destructive/dispatch actions | `Dispatch fix`, `Send test report`, `Run judge now`, `Recover stranded` |
| List rows | No stagger fade-in when transitioning from skeleton to data | Reports, Fixes, Judge, Audit tables |

### E. Tables / lists / visuals

| Issue | Where |
|---|---|
| Severity stripe is 4px and visually weak | `pages/ReportsPage.tsx` row rendering |
| `unique_users` is a number, not a visual blast-radius | `pages/ReportsPage.tsx` |
| `StatusStepper` has no stage labels in beginner mode | `components/StatusStepper.tsx` |
| Reports empty state redirects to wizard — no inline "Send test report" | `pages/ReportsPage.tsx` |
| Empty states are plain text (no hero illustrations) | `EmptyState` primitive |
| Knowledge Graph defaults to React Flow canvas; storyboard exists but only fires under 12 nodes | `pages/GraphPage.tsx` |
| `KpiTile.meaning` is optional → many tiles render with no tooltip | `components/charts.tsx` `KpiTile` callers |
| Sparklines have no axis labels or units | `LineSparkline` / `BarSparkline` / `Histogram` |

### F. Backend wiring spot-checks

All beginner-visible routes (`Dashboard`, `Reports`, `Fixes`, `Judge`, `Health`, `Integrations`, `Settings`, `Onboarding`, `Graph`) hit endpoints in `packages/server/supabase/functions/api/index.ts`. Test sweep deferred to **Phase 6** (`scripts/audit-buttons.mjs`).

### G. Sentry (deferred)

Sentry MCP query for `sakuramoto/mushi-mushi-admin`, `mushi-mushi-server`, `glot-it` (last 7d) deferred to Phase 6 post-implementation sweep so we measure actual delta.

---

## Plan execution order

1. **Phase 1** — Mode toggle + unified PDCA (foundation for everything)
2. **Phase 4** — Microinteractions + 5 new skeletons (low-risk, high-impact)
3. **Phase 2** — Plain-language copy registry
4. **Phase 3** — Live PDCA pipeline centerpiece + demo-report endpoint
5. **Phase 5** — Tables/visuals upgrade
6. **Phase 6** — Dead-button sweep
7. **Phase 7** — Live PDCA verification with glot-it
8. **Phase 8** — Final report
