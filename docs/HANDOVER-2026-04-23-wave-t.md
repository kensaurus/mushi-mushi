# HANDOVER — Wave T (2026-04-23)

Canonical summary of the Wave T PDCA Full Sweep. Pairs with Wave S
(same date) and supersedes no earlier wave.

Read order for the next operator:

1. **This doc** (10 min) — overview + ship/no-ship gates + what's _not_
   done.
2. `docs/audit-2026-04-23/SUMMARY.md` — P0/P1/P2 finding matrix.
3. `docs/audit-2026-04-23/readiness.md` — provider probes + new wire-up
   backlog.
4. The per-domain audit docs under `docs/audit-2026-04-23/` only if a
   specific row needs deeper context.

## What shipped in Wave T

### Fixes (all graded in `SUMMARY.md`)

| Severity | Change                                                           | Files                                                                 |
|----------|------------------------------------------------------------------|-----------------------------------------------------------------------|
| P0       | Six cron jobs fixed via runtime config table                     | `supabase/migrations/20260423040000_wave_t_runtime_config_and_rls_initplan.sql` |
| P0       | `recover_stranded_pipeline` now sends valid Auth to fast-filter  | same migration                                                        |
| P1       | `jwtAuth` returns 401 on malformed tokens (was 500)              | `supabase/functions/_shared/auth.ts`                                  |
| P1       | Anthropic cache telemetry now flows to `llm_invocations`         | `supabase/functions/_shared/telemetry.ts`, `supabase/functions/fast-filter/index.ts` |

### Additions

- `/inbox` Action Inbox page + `⌘⇧I` shortcut + sidebar link.
- `TabbedSubNav` primitive + `VITE_ADVANCED_IA_V2` feature flag
  (collapse is gated off by default).
- `stage2/v3-visual-layout` prompt candidate at 50 % traffic.
- `generate-synthetic` pulls prompt from registry.
- Playwright: `user-story-triage.spec.ts`, `dead-buttons.spec.ts`.
- Audit docs under `docs/audit-2026-04-23/`.
- Test hooks (`data-hero-primary/secondary/verify`,
  `data-inbox-card/primary/secondary`,
  `data-tabbed-sub-nav-tab`).

## What explicitly did NOT ship (deferred to Wave U)

These are not regressions — they were consciously sequenced for a
separate wave because each wants its own reviewable commit:

- **14-page PageHero retrofit.** Wave T shipped the test hooks on the
  `PageHero` component only. Retrofitting onto Dashboard, Reports
  list/detail, Fixes, Repo, Prompt Lab, Research, Projects, Settings,
  SSO, Billing, Integrations, MCP, Marketplace, Notifications is Wave U.
- **Full IA collapse.** `TabbedSubNav` + `VITE_ADVANCED_IA_V2` are
  landed; no routes were collapsed yet. Wave U should implement the
  merged `/plan`, `/do`, `/check`, `/act` pages and 301-redirect the
  legacy routes.
- **New `GET /v1/admin/inbox` edge route.** Inbox reuses
  `/v1/admin/dashboard` for Wave T. Standalone endpoint is only worth
  building when the inbox needs data the dashboard aggregate doesn't
  already surface.
- **Judge-batch cache telemetry.** `classification_evaluations` lacks
  cache columns; a dedicated migration to add them + thread the
  extraction helper through `judge-batch` is Wave U.
- **Dogfood nightly prod PDCA flag flip.** `ENABLE_NIGHTLY_PROD_PDCA=true`
  is the cut-over step in Phase 6 of the plan. The release operator
  must flip it in the GitHub repo secrets only after the post-deploy
  smoke test passes.

## Ship / no-ship gates

Run these in order; do not proceed past any FAIL:

1. `pnpm install` — baseline.
2. `pnpm -r typecheck` — no TS errors introduced this wave.
3. `pnpm -r lint` — admin + server + e2e-dogfood pass.
4. `pnpm --filter @mushi-mushi/admin test` — vitest suite green (Wave
   S baseline).
5. `pnpm check:publish-readiness` — all 6 public packages PASS.
6. `pnpm check:dead-buttons` or
   `pnpm --filter @mushi-mushi/e2e-dogfood e2e -- --grep "dead-button"`
   — no 404 landings on Advanced routes.
7. Apply the two Wave T migrations to `dxptnwrhwsqckaftyymj`:

   ```bash
   supabase db push --project-ref dxptnwrhwsqckaftyymj
   ```

8. Immediately after (P0 gate): update the runtime config row so the
   six cron jobs start succeeding:

   ```bash
   supabase secrets set MUSHI_INTERNAL_CALLER_SECRET="$(openssl rand -base64 48)"
   # Then write the same value to the DB:
   psql "$SUPABASE_DB_URL" \
     -c "UPDATE public.mushi_runtime_config
           SET value = '<token>', updated_at = now()
         WHERE key = 'internal_caller_token';"
   supabase functions deploy
   ```

9. `pnpm changeset version && pnpm release` — publishes the Wave S +
   Wave T changesets in one pass.
10. Push to `master` — CloudFront auto-deploys the admin SPA.
11. Run `user-story-triage.spec.ts` against **production**:

    ```bash
    MUSHI_ADMIN_URL=https://kensaur.us/mushi-mushi \
    MUSHI_DOGFOOD_URL=https://glot-it.vercel.app \
    pnpm --filter @mushi-mushi/e2e-dogfood e2e \
      -- --grep "User story: real user"
    ```

12. Only after that passes: flip `ENABLE_NIGHTLY_PROD_PDCA=true` in the
    GitHub repo variables.

## Rollback

- **Cron / runtime config**: set
  `UPDATE mushi_runtime_config SET value = '' WHERE key =
  'internal_caller_token'`. The helper returns NULL, and the rewritten
  crons' `WHERE … IS NOT NULL` guard short-circuits them — back to
  previous (silently-failing) state, no errors.
- **Admin SPA**: CloudFront invalidation points to the prior S3 prefix.
  Revert the `deploy-admin.yml` artifact by re-running the workflow on
  the previous master SHA.
- **Prompt candidate**:
  `DELETE FROM prompt_versions WHERE stage='stage2' AND version='v3-visual-layout' AND project_id IS NULL;`
  `prompt_auto_tune` reverts to 100 %-traffic `v1-baseline` on the
  next cron tick.
- **TabbedSubNav / IA v2**: unset `VITE_ADVANCED_IA_V2` in CloudFront
  origin config. No redeploy required.

## Metrics to watch post-deploy (first 24 h)

- `llm_invocations.cache_read_input_tokens` > 0 for ≥ 50 % of new
  fast-filter rows (was 0 % before Wave T).
- `cron.job_run_details.status = 'succeeded'` for all six renamed jobs.
- Sentry `mushi-mushi-server` `error.type:internal` rate should drop
  because the 401-storm path is fixed; expect Sentry event count to
  halve within an hour of deploy.
- Judge disagreement rate on visual-layout-tagged reports: target drop
  from ~62 % to < 30 % within 72 h as `v3-visual-layout` takes its 50 %
  share.
- Admin `/inbox` route: first-week DAU (should be the first page
  Advanced users land on, competing only with `/` Dashboard).

## Contact

Author: Claude (Cursor agent). Operator: @sakuramoto. File bugs at
`sakuramoto/mushi-mushi-admin` (UX) or `mushi-mushi-server` (pipeline).
