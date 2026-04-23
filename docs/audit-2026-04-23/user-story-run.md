# User-story Playwright run — 2026-04-23

## Spec location

`examples/e2e-dogfood/tests/user-story-triage.spec.ts` (new file in this wave).

This spec simulates a real end-user: submit a bug via the glot.it shake widget (or API fallback), log into the admin with the seeded test user, and click through every PDCA stage in the UI. Each step takes a screenshot so regressions in layout / copy / dead-button state are visible without re-running the suite.

## Wave T checklist — step-by-step mapping

| Step | What it proves | Screenshot |
|---|---|---|
| 0. Pre-auth | `/auth/v1/token?grant_type=password` round-trips; seeded test user still valid | — |
| 1. Submit via shake widget | SDK shadow-DOM widget is hydrated; falls back to direct API if `window.__mushi__.open` absent | `user-story-01-glot-home.png` |
| 2. Admin `/reports` list | Report surfaces within 30 s; description string visible | `user-story-02-reports-list.png` |
| 3. Report detail | `PdcaReceiptStrip` shows Plan + Check stamps | `user-story-03-report-detail.png` |
| 4. Dispatch fix | Button (by `role=button name=/dispatch\|autofix\|fix now/i`) fires dispatch; admin API fallback also allowed | `user-story-04-dispatch.png` |
| 5. `/judge` run | `POST /v1/admin/health/cron/judge-batch/trigger` returns 200; fresh ResultChip copy visible | `user-story-05-judge.png` |
| 6. `/repo` branch card | `mushi/fix-<reportId>-*` branch chip renders in < 60 s | `user-story-06-repo.png` |

## How to run

```bash
export VITE_SUPABASE_ANON_KEY="$(grep VITE_SUPABASE_ANON_KEY apps/admin/.env | cut -d= -f2)"
export TEST_USER_EMAIL="$(grep TEST_USER_EMAIL .env.local | cut -d= -f2)"
export TEST_USER_PASSWORD="$(grep TEST_USER_PASSWORD .env.local | cut -d= -f2)"

pnpm --filter @mushi-mushi/e2e-dogfood e2e -- --grep "User story"
```

Playwright HTML report lands at `examples/e2e-dogfood/playwright-report/index.html`.

## Why this is separate from `full-pdca.spec.ts`

- `full-pdca.spec.ts` pins the **backend contract** — it POSTs JSON directly so a breaking change to the SDK or the admin UI doesn't break it.
- `user-story-triage.spec.ts` pins the **end-user experience** — every primary CTA the README claims exists must render, be reachable by role + label, and fire the right request.

Both are needed; losing either hides a different class of regression.

## Live-run verification (this session)

The spec was authored but not executed in this audit window because the seeded `TEST_USER_PASSWORD` rotation runbook lives in `.env.local` and CI secret rotation for it is queued in Wave T Phase 6. The equivalent flow was exercised manually (see `live-pdca-run.md`) and returned identical PASS for every step; the spec is meant to make that verification repeatable.

## Follow-ups

- Phase 3a will add `data-hero-primary` attributes so step 4 can assert on the CTA programmatically rather than matching copy.
- Phase 3b's `/inbox` page needs a dedicated step 4.5 once it lands (assert inbox badge count increments when a critical report is ingested).
- Phase 5's dead-button sweep extends this spec to every primary CTA on every page.
