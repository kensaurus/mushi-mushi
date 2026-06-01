-- Migration: fix_tester_rls_initplan
-- PURPOSE: The original tester-marketplace migrations (20260523000000 through
--   20260523009000) used bare auth.uid() in every self-read/write RLS policy.
--   This causes auth.uid() to be re-evaluated per row (an "initplan"), which
--   the Supabase auth_rls_initplan advisor flags as a performance hazard.
--   The correct pattern wraps the call in a scalar subquery:
--     (SELECT auth.uid())
--   so it is evaluated once per statement.
--
--   Drop-and-recreate is required; ALTER POLICY cannot change the USING
--   expression. The policies recreated here are semantically identical to
--   their originals — only the auth.uid() wrapper changes.
--
-- TABLES AFFECTED (one policy each unless noted):
--   mushi_testers              — mushi_testers_self_rw          (USING + WITH CHECK)
--   mushi_tester_profiles      — mushi_tester_profiles_self_rw  (USING + WITH CHECK)
--   tester_app_subscriptions   — tester_subs_self               (USING + WITH CHECK)
--   tester_submissions         — tester_submissions_self_read
--   tester_credit_ledger       — tester_ledger_self_read
--   tester_balances            — tester_balances_self_read
--   tester_reputation          — tester_rep_self_read
--   tester_redemptions         — tester_redemptions_self_read
--   tester_kyc                 — tester_kyc_self_read
--   tremendous_orders          — tremendous_orders_self_read
--   tester_reputation_events   — tester_rep_events_self_read

-- ── mushi_testers ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS mushi_testers_self_rw ON public.mushi_testers;
CREATE POLICY mushi_testers_self_rw ON public.mushi_testers
  FOR ALL TO authenticated
  USING (auth_user_id = (SELECT auth.uid()))
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

-- ── mushi_tester_profiles ────────────────────────────────────────────────────
DROP POLICY IF EXISTS mushi_tester_profiles_self_rw ON public.mushi_tester_profiles;
CREATE POLICY mushi_tester_profiles_self_rw ON public.mushi_tester_profiles
  FOR ALL TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())))
  WITH CHECK (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_app_subscriptions ─────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_subs_self ON public.tester_app_subscriptions;
CREATE POLICY tester_subs_self ON public.tester_app_subscriptions
  FOR ALL TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())))
  WITH CHECK (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_submissions ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_submissions_self_read ON public.tester_submissions;
CREATE POLICY tester_submissions_self_read ON public.tester_submissions
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_credit_ledger ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_ledger_self_read ON public.tester_credit_ledger;
CREATE POLICY tester_ledger_self_read ON public.tester_credit_ledger
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_balances ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_balances_self_read ON public.tester_balances;
CREATE POLICY tester_balances_self_read ON public.tester_balances
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_reputation ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_rep_self_read ON public.tester_reputation;
CREATE POLICY tester_rep_self_read ON public.tester_reputation
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_redemptions ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_redemptions_self_read ON public.tester_redemptions;
CREATE POLICY tester_redemptions_self_read ON public.tester_redemptions
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_kyc ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_kyc_self_read ON public.tester_kyc;
CREATE POLICY tester_kyc_self_read ON public.tester_kyc
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tremendous_orders ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tremendous_orders_self_read ON public.tremendous_orders;
CREATE POLICY tremendous_orders_self_read ON public.tremendous_orders
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));

-- ── tester_reputation_events ─────────────────────────────────────────────────
DROP POLICY IF EXISTS tester_rep_events_self_read ON public.tester_reputation_events;
CREATE POLICY tester_rep_events_self_read ON public.tester_reputation_events
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = (SELECT auth.uid())));
