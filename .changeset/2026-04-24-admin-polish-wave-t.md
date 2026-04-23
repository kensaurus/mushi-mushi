---
"@mushi-mushi/admin": patch
"@mushi-mushi/server": patch
"@mushi-mushi/e2e-dogfood": patch
---

Admin polish Wave T — trust, speed, density (2026-04-24)

Five sub-waves of console polish that each leave the app in a shipping
state. Every primitive is motion-safe, visibility-gated, and wrapped in
`aria-live` where it speaks.

- **T.1 Foundation primitives** —
  - `<FreshnessPill>` + `usePageData.lastFetchedAt` + `useRealtimeReload` channel state: every `<Section>` can now opt in to a top-right `Updated Xs ago` chip that pulses on revalidate and rings red when Realtime drops. Adopted on Reports, Fixes, Health, Judge, Dashboard.
  - `<ActiveFiltersRail>` — removable `<FilterChip>` rail above Reports / Fixes / Audit with a trailing "Clear all" once 2+ filters are active.
  - `<RouteProgress>` — 2 px brand bar that eases 0 → 70 % on React Router `navigation.state === 'loading'`, completes + fades on `'idle'`. Mounted once in `Layout.tsx`, `motion-safe:` gated.
- **T.2 Feedback loops** —
  - New `report_bulk_mutations` table (migration `20260424000000_report_bulk_mutations_log.sql`) snapshots prior status / severity / category on every bulk action. `POST /v1/admin/reports/bulk` now returns `{ mutation_id, affected }`; new `POST /v1/admin/reports/bulk/:id/undo` restores the snapshot within a 10-minute window. `useUndoableBulk` adds an `Undo` action to the existing success toast; covered by `reports-bulk-undo.spec.ts`.
  - `@keyframes mushi-row-flash` + `useRowFlash` — single-shot tone-washed background animation fires when a row's status / severity transitions, never on first mount. Adopted in `ReportRowView` and `FixCard`.
- **T.3 Staged live-state** — `useStagedRealtime` + `<StagedChangesBanner>` — INSERT events during active triage (selection / cursor / scroll > 0) are staged into a counter instead of auto-repainting the list; the sticky `N new rows · Apply · Discard` banner (announced via `aria-live="polite"`) lets the user opt in when ready. UPDATE / DELETE still debounce-reload like before. Covered by `staged-realtime-banner.spec.ts`.
- **T.4 Chart time-range brushing** — `useBrushSelection` (with unit-tested `brushIndexFromClient` / `normaliseBrushRange` helpers) gives `LineSparkline` / `BarSparkline` an `onRangeSelect` prop. `pointer: coarse` devices skip registration; `ESC` cancels; a semi-transparent brand rect previews the range during drag. Adopted on JudgePage's weekly trend (deep-links to filtered evaluations) and Dashboard's LLM tokens / calls sparklines (deep-links to filtered Reports).
- **T.5 Chart event annotations** — New `admin_chart_events` view (migration `20260424010000_admin_events_view.sql`) unions deploy markers from `audit_logs`, non-success ticks from `cron_runs`, and BYOK rotation actions from `byok_audit_log` into a common `(occurred_at, kind, label, href, project_id)` shape. `GET /v1/admin/chart-events?kinds=deploy,cron,byok` returns at most 200 events, Zod-validated via `ChartEventsResponseSchema`. `<ChartAnnotations>` overlay drops a 1 px dashed vertical line + tone dot per event (`deploy → brand`, `cron → info`, `byok → warn`) with hover tooltips and optional `View →` deep-links. Variants: `full` on JudgePage, `dot` on the dense Dashboard KPI sparklines. Covered by `chart-annotations.spec.ts`.
- **Cross-cutting** — README sweep on `apps/admin/README.md` + `examples/e2e-dogfood/tests/README.md` with every new primitive / endpoint / spec documented.
