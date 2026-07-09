# Polish Backlog — Round 2

_Generated: 2026-04-20. Plan: `mushi_ux_polish_round_2`._

This is the live-verification + code-audit output that drives Round 2. The
overhaul (`REPORT.md`) is the new baseline; this file tracks the deeper
polish layered on top.

## Live verification snapshot

| Check | Result |
|---|---|
| Admin reachable on [`localhost:6464`](http://localhost:6464/) | ✓ 200, page title resolves |
| `glot-it` reachable on [`localhost:3000/glot-it/`](http://localhost:3000/glot-it/) | ✗ connection refused — **dogfood live-recording deferred** |
| Beginner mode dashboard renders | ✓ HeroIntro + PDCA storyboard + LivePdcaPipeline + cockpit + KPI strip + charts |
| Console errors on `/` | 0 errors, 0 warnings (only React DevTools tip) |
| Advanced mode toggle | ✓ persisted via `useAdminMode`, sidebar reveals all 23 routes |
| Advanced page sample (`/anti-gaming`) | ✓ KPI strip, tables, badges all rendered, 0 console errors |
| Dead-button crawler (`scripts/audit-buttons.mjs`) | ⚠ requires `MUSHI_ADMIN_EMAIL/PASSWORD` env vars — no test creds in repo, so mechanical run blocked. Manual sweep below. |

Screenshots:
- `polish-dashboard-beginner.png` — full beginner dashboard, dark mode
- `polish-anti-gaming.png` — advanced empty-state-rich page

## Manual button sweep (top-leverage paths)

I clicked through the highest-traffic CTAs on the running admin (no LLM-spend
buttons fired). Findings:

| Surface | Button | Status |
|---|---|---|
| Sidebar | "Switch to advanced/beginner mode" | ✓ persists, filters nav |
| Dashboard hero | "Watch a bug travel through Mushi" | ✓ wired (skipped click — fires real synthetic report) |
| Dashboard NBA | "Open Judge →" | ✓ navigates |
| Dashboard PdcaCockpit | All 4 stage CTAs | ✓ navigate to filtered routes |
| Dashboard KPI tiles | Reports/Backlog/PRs/Tokens | ✓ all link to deep routes |
| Anti-Gaming | Refresh / Unflag / Details | rendered, not fired (mutating) |

## Round 2 polish targets

### P1 — high impact, addressed in this round

- **Sparklines + Δ chip on every KPI row.** Today only the dashboard `Reports
  (14d)` tile shows a delta chip; Backlog / PRs / Tokens / Reports-by-severity
  / Fixes / Queue rows don't, even though the data exists. Scope:
  - [`apps/admin/src/components/charts.tsx`](apps/admin/src/components/charts.tsx) `KpiTile` — add optional `series?: number[]` and render `LineSparkline` footer
  - [`apps/admin/src/components/dashboard/KpiRow.tsx`](apps/admin/src/components/dashboard/KpiRow.tsx) — pass series + Δ on all 4 tiles
  - [`apps/admin/src/components/reports/ReportsKpiStrip.tsx`](apps/admin/src/components/reports/ReportsKpiStrip.tsx) — pass per-severity series + Δ
  - [`apps/admin/src/components/fixes/FixSummaryRow.tsx`](apps/admin/src/components/fixes/FixSummaryRow.tsx) — embed series in tiles instead of separate card
  - [`apps/admin/src/components/dlq/QueueKpiRow.tsx`](apps/admin/src/components/dlq/QueueKpiRow.tsx) — same

- **Severity-stacked-bars rich tooltip.** Current per-bar hover only shows
  total + a `title` HTML attribute. Promote to a real popover with severity
  breakdown so the chart is queryable without leaving it.
  - [`apps/admin/src/components/charts.tsx`](apps/admin/src/components/charts.tsx) `SeverityBarColumn`

- **PdcaCockpit micro-trend.** Each stage card is static. Add a 7-day spark in
  the header so each stage shows momentum at a glance.
  - [`apps/admin/src/components/dashboard/PdcaCockpit.tsx`](apps/admin/src/components/dashboard/PdcaCockpit.tsx)
  - [`apps/admin/src/components/dashboard/types.ts`](apps/admin/src/components/dashboard/types.ts) — extend `PdcaStage` with optional `series?: number[]`
  - Backend already returns the daily counts; frontend slice it per stage.

- **First-fix-merged confetti.** Peak-end moment when `merged_fix_count`
  flips 0→1. Pure CSS confetti — no library.
  - [`apps/admin/src/lib/setup.ts`](apps/admin/src/lib/setup.ts) reload path or new `useFirstMergedFix` hook
  - New `apps/admin/src/components/Confetti.tsx`

- **Test-button success pulse.** Test/Run buttons return `ResultChip` already,
  but the card itself doesn't acknowledge the success. Add a 600ms green ring
  pulse on the card on `success` transition.
  - [`apps/admin/src/components/integrations/PlatformIntegrationCard.tsx`](apps/admin/src/components/integrations/PlatformIntegrationCard.tsx)
  - Reuse same `usePulseOnChange` helper across BYOK/Storage/DLQ test paths.

- **Toast progress bar.** Toasts already pause on hover. Add a thin draining
  bar so the user sees how long they have to read.
  - [`apps/admin/src/lib/toast.tsx`](apps/admin/src/lib/toast.tsx)

- **Hero illustrations on advanced empty states.** Beginner empty states have
  hero icons; advanced ones don't. Backfill at least the 7 most-visited
  advanced surfaces.
  - [`apps/admin/src/components/illustrations/HeroIllustrations.tsx`](apps/admin/src/components/illustrations/HeroIllustrations.tsx) — add `HeroQueue`, `HeroShield`, `HeroBell`, `HeroAudit`, `HeroMarket`, `HeroStorage`, `HeroCompliance`
  - Wire into Anti-Gaming, Marketplace, DLQ, Compliance, Notifications, Audit, Storage `EmptyState`s.

- **Advanced-mode copy registry populated.** `COPY.advanced` is empty in
  [`apps/admin/src/lib/copy.ts`](apps/admin/src/lib/copy.ts); toggling mode
  only swaps one direction (advanced → beginner). Populate the same 9 keys
  with the original jargon-rich copy power users expect.

### P2 — defer to Round 3

- **Mobile responsive deep-dive.** Tablet + 375 captures look acceptable but
  some KPI grids stack awkwardly at < 480px. Layout-level fixes deferred
  unless captures reveal breakage.
- **Raw `<button>` outside `components/ui`.** A small set of pages still use
  `type="button"` directly (LoginPage:7, QueryPage:5, ResearchPage:4,
  GraphPage:4). Most are intentional (icon buttons, tabs, segmented controls)
  — sweep and document which need `<Btn>` for uniform loading/disabled state.
- **Live screen recording of the dogfood loop.** Requires `glot-it` running on
  port 3000; deferred pending env setup.
- **Sentry INP delta** vs prior 7 days — covered by post-deploy verification
  after Round 2 ships.
- **glot-it SDK polish** — out of scope for the admin repo; file follow-up
  issue in `glot-it`.

### P3 — already healthy

- Token violation sweep: `rg "(#[0-9a-fA-F]{3,8}|rgb\(|rgba\()" apps/admin/src`
  returns **zero matches** outside generated CSS. Visual personality via
  arbitrary tailwind brackets (`text-[10px]`, `min-h-[2rem]`) is sparse and
  intentional.
- Mixed icon libraries: `lucide-react` + custom `HeroIllustrations` only.
- AI-tells: section padding varies, KPI grid breaks at multiple breakpoints,
  accent isn't painted on every surface — passes the design-system skill's
  smell test on the dashboard sample.

## Out of scope this round

- Whitepaper P0 architecture from `MushiMushi_Critical_Analysis.md`
  (structured outputs, prompt caching, LLM-as-judge enrichment) — separate
  release.
- Throwing away anything in the existing diff.
