---
"@mushi-mushi/admin": patch
"@mushi-mushi/server": patch
"@mushi-mushi/e2e-dogfood": patch
---

PDCA hardening (Wave S — 2026-04-23)

Full-sweep production-readiness pass for the user-facing PDCA loop:

- **UX / IA** — Introduced `PageHero` (Decide / Act / Verify three-tile layout) and wired it into 10 Advanced-mode pages (Judge, Health, Audit, Compliance, Intelligence, DLQ, Graph, Anti-Gaming, Storage, Query), replacing the previous charts-first layout. Charts now live below the fold.
- **Pipeline pulse** — New `PipelineStatusRibbon` mounted in the Advanced layout so operators see P / D / C / A health at a glance regardless of which page they're on. Drives Check tile freshness from a shared localStorage key that HealthPage stamps on every successful load.
- **NBA rule engine** — Extended `useNextBestAction` with 8 new scopes (dlq, prompt-lab, repo, mcp, billing, notifications, marketplace, integrations) and added 19 vitest tests pinning rule priority so future refactors can't silently demote remediation urgency. Admin workspace now has a `test` / `test:watch` script and vitest config.
- **Release CI parity** — `.github/workflows/release.yml` now runs the same post-test gates as ci.yml (changelog sync, publish readiness, license headers, dead-button scan, bundle size). Added dead-button scan to ci.yml as well.
- **Nightly prod PDCA** — New `.github/workflows/nightly-prod-pdca.yml` runs the full E2E suite against the production Supabase stack nightly, uploads the Playwright report, and opens / updates a regression issue on failure. Gated behind `ENABLE_NIGHTLY_PROD_PDCA` repo variable.
- **E2E fix** — `full-pdca.spec.ts` dedup polling now reads `report_group_id` (the actual column name on the `reports` table) instead of the deprecated `cluster_id` / `dedup_parent_id` names.
- **API robustness** — `/v1/admin/fixes/dispatch` now wraps its handler in try/catch with structured logging so a bad row / missing setting no longer returns an opaque 500. Uses `.maybeSingle()` for membership + settings lookups so a brand-new project doesn't fail dispatch.
- **SWR semantics** — `usePageData` now exposes `isValidating` alongside `loading`, so pages can distinguish "first paint" from "background revalidate" and avoid full-page skeletons on refresh.
- **Playwright hardening** — `full-pdca.spec.ts` lazy-constructs the service-role Supabase client so the suite now gracefully skips (6 skipped, clear reason) when `SUPABASE_SERVICE_ROLE_KEY` is absent instead of crashing at module load. The `admin-polish` helpers now also accept `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` as fallbacks to match `.env.local`.
- **UI polish** — New `Abbr` primitive (semantic `<abbr>` with dotted underline + cursor-help) and replaced ad-hoc uppercase acronyms with it (PDCA loop, severity badges). Severity labels now use short forms (Crit / High / Med / Low) in scan rows with the full form on hover. Report detail header now glows softly with the severity colour. Health page cron cards pick up `statusGlowClass`. Intelligence completion rate uses the `Pct` primitive with `direction="higher-better"`. Token map gained `queued`, `resolved`, and `success` statuses.
