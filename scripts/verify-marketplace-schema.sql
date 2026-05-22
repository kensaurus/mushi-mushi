-- verify-marketplace-schema.sql
-- PURPOSE: Post-deployment verification queries for the Mushi Bounties migrations.
-- Run these in the Supabase SQL editor (or via psql) after applying all
-- 20260523xxxxxx_*.sql migrations to confirm the schema and RLS are correct.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Confirm all Wave 1 tables exist.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'mushi_testers',
     'mushi_tester_profiles',
     'published_apps',
     'published_app_bounties',
     'published_app_targeting',
     'tester_app_subscriptions',
     'tester_submissions',
     'tester_credit_ledger',
     'tester_balances',
     'tester_reputation',
     'tester_redemptions',
     'tester_kyc',
     'tremendous_orders',
     'tester_reputation_events'
   )
 ORDER BY table_name;
-- Expected: 14 rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Anon can read public published_apps (RLS must allow this).
-- ─────────────────────────────────────────────────────────────────────────────
SET ROLE anon;
SELECT COUNT(*) FROM public.published_apps WHERE visibility = 'public';
-- Expected: 0 (no apps published yet) — should NOT raise a permission error.
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Anon can read the public leaderboard view.
-- ─────────────────────────────────────────────────────────────────────────────
SET ROLE anon;
SELECT COUNT(*) FROM public.tester_leaderboard_30d_public;
-- Expected: 0 (no testers yet) — should NOT raise a permission error.
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Confirm new columns on reports table.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'reports'
   AND column_name IN ('tester_id', 'tester_submission_id')
 ORDER BY column_name;
-- Expected: 2 rows, both nullable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Confirm new columns on project_settings table.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'project_settings'
   AND column_name IN (
     'marketplace_published_app_id',
     'marketplace_monthly_budget_usd',
     'marketplace_max_testers'
   );
-- Expected: 3 rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Confirm pricing_plans have the new feature flags.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT plan_slug,
       feature_flags ->> 'marketplace_publish' AS marketplace_publish,
       feature_flags ->> 'tester_cashout'      AS tester_cashout,
       feature_flags ->> 'marketplace_priority_listing' AS priority
  FROM public.pricing_plans
 ORDER BY plan_slug;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Confirm RPCs exist.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT routine_name, routine_schema
  FROM information_schema.routines
 WHERE routine_schema IN ('public', 'private')
   AND routine_name IN (
     'export_tester_data',
     'delete_tester_data',
     'award_tester_points',
     'check_marketplace_budget',
     'handle_new_tester_user',
     'sync_tester_balance',
     'recompute_tester_reputation'
   )
 ORDER BY routine_name;
-- Expected: 7 rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Confirm pg_cron jobs registered.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT jobname, schedule, command
  FROM cron.job
 WHERE jobname IN (
   'refresh-tester-leaderboard-30d',
   'recompute-tester-reputation-daily'
 );
-- Expected: 2 rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Smoke-test the auto-provision trigger path (dry-run).
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Run this only in a staging environment. It inserts a fake auth.users row.
-- Comment out before running on production.
/*
BEGIN;
  INSERT INTO auth.users (id, email, raw_app_meta_data)
  VALUES (
    gen_random_uuid(),
    'tester-verify-smoke@example.com',
    '{"signup_intent": "tester"}'::jsonb
  );
  SELECT COUNT(*) FROM public.mushi_testers
   WHERE auth_user_id IN (
     SELECT id FROM auth.users WHERE email = 'tester-verify-smoke@example.com'
   );
  -- Expected: 1
ROLLBACK;
*/
