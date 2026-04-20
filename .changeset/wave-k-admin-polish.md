---
"@mushi-mushi/web": patch
"@mushi-mushi/react": patch
"@mushi-mushi/core": patch
---

**Wave K — admin console UX overhaul + microinteraction sweep + 4 frontend bug fixes (no SDK behaviour change).**

The published SDKs are unchanged in this release; the bump is to align the npm tarball with the updated cross-link README + the new admin console (`@mushi-mushi/admin@0.1.0`) that SDK consumers are pointed at from the dashboard.

What ships behind it (admin-side, visible to anyone running `npx mushi-mushi` and landing in the console):

- `PageHelp` defaults open only on the user's first ever visit (single global `mushi:visited` flag) instead of bombarding returning admins with re-opened help on every page.
- `PageHeader` accepts a `projectScope` prop; `Reports / Fixes / Judge / Graph / Health / Compliance` thread the active project name through so headers read `Reports · glot-it`.
- New `<ResultChip>` primitive — persistent inline `✓ Connection OK · 2s ago` receipt for every Test / Run / Trigger button. Adopted across BYOK / Firecrawl / Health quick-tests.
- Layout-shaped skeletons (`DashboardSkeleton`, `TableSkeleton`, `DetailSkeleton`, `PanelSkeleton`) replace 22 page-level spinner-on-blank loaders so first paint matches the loaded layout.
- Microinteractions: animated toasts (in 180ms / out 140ms), modal scrim fade-in + panel scale-in, sliding-underline tab indicator on Settings (with `ResizeObserver` so it stays aligned on viewport resize).
- Pre-setup dashboard reveal: brand-new admins see `SetupChecklist + HeroIntro` only until the first report lands.

Frontend bug fixes:

- `ByokPanel` `testedAt` no longer recomputes `new Date()` on every render — the `<RelativeTime>` chip now correctly reads "X seconds ago" instead of perpetually "just now".
- `toast` exit-timer guard prevents double-dismiss from leaking the original timer.
- `ReportsKpiStrip` surfaces `/v1/admin/reports/severity-stats` failures inline with retry instead of silently rendering zeros.
- `Compliance` DSAR creation switched to snake_case + explicit `projectId` to match the backend validator (was producing a persistent 400).
- `Sentry.withSentryReactRouterV7Routing` wrapper moved to the auth-gate inner Routes so transactions report parametrized names (`/reports/:id`) instead of being collapsed to `/*`.
- `SeverityStackedBars` no longer composes two scale ratios — non-max columns now render at their true height.

Server-side compliance fixes (deployed separately to Supabase Edge Functions, not part of the npm tarball but part of this release):

- `logAudit()` calls in `compliance/retention`, `compliance/dsars` (POST + PATCH), and `compliance/evidence/refresh` rewritten to use positional args; new `'compliance.dsar.updated'` audit added to PATCH (was a missing audit row); `cronRun.complete()` corrected to `cronRun.finish()` in `soc2-evidence`.
