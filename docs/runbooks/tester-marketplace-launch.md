# Tester Marketplace Launch Runbook

This runbook covers the pre-launch checklist and verification queries for
the **Mushi Bounties** tester marketplace feature. Complete every item in
order before flipping `marketplace_publish=true` on any production plan.

---

## Schema + DB checklist

- [ ] All migrations applied and verified (run in order):
  - `20260523000000_mushi_testers_identity.sql`
  - `20260523001000_published_apps.sql`
  - `20260523002000_tester_submissions_and_subscriptions.sql`
  - `20260523003000_tester_credit_ledger.sql`
  - `20260523004000_tester_redemptions_and_kyc.sql`
  - `20260523005000_marketplace_entitlements.sql`
  - `20260523006000_mushi_tester_auto_provision.sql`
  - `20260523007000_tester_leaderboard_mv.sql`
  - `20260523008000_reports_tester_link.sql`
  - `20260523009000_tester_reputation_signals.sql`
  - `20260523010000_tester_submissions_content.sql`
  - `20260523020000_tremendous_redemption_worker_cron.sql`
  - `20260523030000_recompute_tester_reputation_cron.sql`

```sql
-- Verify all tables exist:
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'mushi_testers', 'published_apps', 'tester_app_subscriptions',
  'tester_submissions', 'tester_credit_ledger', 'tester_balances',
  'tester_reputation', 'tester_redemptions', 'tester_kyc',
  'tremendous_orders', 'tester_reputation_events'
)
ORDER BY tablename;
-- Expected: 11 rows.

-- Verify RLS is enabled:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
AND tablename LIKE 'tester%'
ORDER BY tablename;
-- All should have rowsecurity = true.

-- Verify anon can browse public apps:
SET ROLE anon;
SELECT id, slug, name FROM published_apps WHERE visibility = 'public' LIMIT 5;
RESET ROLE;

-- Verify award_tester_points RPC exists:
SELECT proname FROM pg_proc WHERE proname = 'award_tester_points';

-- Verify refresh_tester_leaderboard RPC exists:
SELECT proname FROM pg_proc WHERE proname = 'refresh_tester_leaderboard';

-- Verify tester_leaderboard_30d MV exists:
SELECT matviewname FROM pg_matviews WHERE matviewname = 'tester_leaderboard_30d';
```

- [ ] marketplace_publish=true enabled on Pro+ plans only:

```sql
SELECT id, feature_flags
FROM pricing_plans
WHERE (feature_flags->>'marketplace_publish')::boolean = true;
-- Should return only pro and enterprise rows.
```

---

## Tremendous checklist

- [ ] Tremendous sandbox account created at https://testflight.tremendous.com
- [ ] KYB (Know Your Business) approval from Tremendous received
- [ ] Production account funded with seed balance
- [ ] `TREMENDOUS_API_KEY` set in edge function environment (production Supabase dashboard → Functions → Settings)
- [ ] `TREMENDOUS_WEBHOOK_SECRET` set (register webhook at Tremendous dashboard → Webhooks → `https://your-api-url/v1/webhooks/tremendous`)
- [ ] `tremendous_funding_source_id` updated in `mushi_runtime_config`:

```sql
UPDATE public.mushi_runtime_config
SET value = '"your_actual_funding_source_id"'
WHERE key = 'tremendous_funding_source_id';
```

- [ ] Test order sent in Tremendous sandbox and confirmed received in `tremendous_orders` table
- [ ] Webhook round-trip verified: order created → status updated to 'processing' → webhook fires → status updated to 'complete'

---

## OFAC / sanctions checklist

- [ ] OFAC denied list reviewed against current OFAC SDN list (review date: _____________)
  - Reference: `packages/server/supabase/functions/_shared/sanctions.ts`
- [ ] Next review scheduled for: _____________ (quarterly)
- [ ] Test that a tester with country_code='IR' (Iran) cannot join an app or redeem gift cards
- [ ] Test that a tester with country_code='US' CAN redeem gift cards (no false positive)

---

## Legal review checklist

- [ ] One-shot US gig-economy / promo-law attorney review complete. Review date: _____________
  - [ ] 1.3× Pro-upgrade premium framing reviewed (coupon, not compensation)
  - [ ] $599/yr per-tester cap as 1099 deferral mechanism reviewed
  - [ ] Tremendous as the money-transmitter shield reviewed
  - [ ] Amazon gift-card marketing language reviewed ("rewards including Amazon" ≠ "earn Amazon gift cards")
- [ ] Marketing copy audit: NO UI says "earn Amazon gift cards" — only "100+ rewards including Amazon"

---

## KYC checklist

- [ ] KYC threshold set correctly in `mushi_runtime_config`:

```sql
SELECT key, value FROM mushi_runtime_config
WHERE key = 'tester_kyc_threshold_usd';
-- Should be 400 (the $400 internal threshold; legal threshold is $600).
-- If missing: INSERT INTO mushi_runtime_config (key, value) VALUES ('tester_kyc_threshold_usd', '400');
```

- [ ] Test W-9 path: tester with country_code='US' exceeds $400 → KycForm appears on settings page
- [ ] Test W-8BEN path: tester with country_code='GB' exceeds $400 → KycForm appears with W-8BEN copy
- [ ] KYC admin review flow tested (reviewer can clear withholding_status from 'pending' → 'cleared')

---

## End-to-end smoke test

Five internal testers must run the full flow on staging before production launch:

1. **Browse** — Visit `https://kensaur.us/mushi-mushi/testers/` (public Next.js marketplace) without logging in. Confirm app listings render.
2. **Join** — Click "Join to test" on an app. Magic-link login flow → redirected to `/tester/apps/[slug]/join`. Confirm `tester_app_subscriptions` row created.
3. **Submit** — Submit a bug report from `/tester/apps/[slug]`. Confirm:
   - `tester_submissions` row created
   - Corresponding `reports` row created with `tester_id` set
   - If app has a Sentry DSN: event appears in Sentry tagged `source: mushi-bounties`
4. **Accept** — Dev reviewer accepts submission from `ReportDetailPage`. Confirm:
   - `tester_submissions.status = 'accepted'`
   - `tester_credit_ledger` row with `delta_points > 0` created
   - `tester_balances.current_points` updated
5. **Redeem (closed-loop)** — Tester redeems points for Mushi Pro credit (1.3× premium). Confirm:
   - `tester_redemptions` row with `status = 'complete'` and `premium_multiplier = 1.3`
   - Stripe customer balance credit applied (check Stripe dashboard)
6. **Redeem (gift card)** — Tester redeems points for an Amazon gift card. Confirm:
   - `tremendous_orders` row created with `status = 'pending'`
   - After cron runs: status → 'processing', external_id set
   - After Tremendous webhook: status → 'complete'
7. **Reputation cron** — Manually trigger `recompute-tester-reputation`. Confirm `tester_reputation.score` updated.

---

## Verification queries post-launch

```sql
-- Check active testers in the last 7 days:
SELECT COUNT(*) FROM mushi_testers
WHERE created_at > NOW() - INTERVAL '7 days';

-- Check pending submissions awaiting review:
SELECT COUNT(*) FROM tester_submissions WHERE status = 'pending';

-- Check withheld redemptions (should be 0 for a healthy launch):
SELECT COUNT(*) FROM tester_redemptions WHERE status = 'withheld';

-- Check Tremendous orders in flight:
SELECT status, COUNT(*) FROM tremendous_orders GROUP BY status;

-- Check reputation scores:
SELECT AVG(score), MIN(score), MAX(score) FROM tester_reputation;

-- Check leaderboard materialized view freshness:
SELECT refreshed_at FROM tester_leaderboard_30d ORDER BY refreshed_at DESC LIMIT 1;
```

---

## Rollback plan

If a critical issue is found post-launch:

1. Set `marketplace_publish=false` for all plans via `pricing_plans.feature_flags` — stops new publishing. Existing apps stay visible but new ones can't be added.
2. Disable the `tremendous-redemption-worker` cron: `SELECT cron.unschedule('tremendous-redemption-worker');`
3. Set `published_apps.visibility='paused'` for all affected apps.
4. All tester data and redemptions are preserved — rollback is non-destructive.

---

*Last updated: 2026-05-22 by implementation agent. Next OFAC review: 2026-08-22.*
