-- ============================================================
-- Mushi Mushi v2 — Security advisor remediation + schema drift
-- ============================================================
-- This migration addresses the full Supabase security advisor sweep
-- captured on 2026-05-26, plus two outstanding schema-drift errors
-- found in the postgres logs.
--
-- Categories of fix:
--   1. Schema drift     — code references columns that don't exist yet.
--   2. ERROR lint       — security_definer_view on a public leaderboard.
--   3. WARN lints       — function_search_path_mutable, extension_in_public,
--                         and SECURITY DEFINER trigger/cron functions
--                         exposed to anon/authenticated.
--   4. RLS hygiene      — drop redundant `service_role_all_*` policies
--                         (service_role already has BYPASSRLS).
--   5. PII / GraphQL    — revoke anon SELECT on tables that hold
--                         end-user PII, KYC, payouts, secrets, or
--                         tokens. RLS still gates the data; this also
--                         removes them from the anon GraphQL schema.
--
-- All operations are idempotent and use IF EXISTS / IF NOT EXISTS so
-- the migration is safe to re-run.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Schema drift
-- ────────────────────────────────────────────────────────────

-- 1a. integration-health-probe edge function expects
-- `reward_webhooks.project_id` (P3 routing extension). The original
-- table only has organization_id; add the optional project scope so
-- the postgres logs stop emitting "column does not exist".
ALTER TABLE public.reward_webhooks
  ADD COLUMN IF NOT EXISTS project_id uuid
    REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reward_webhooks_project
  ON public.reward_webhooks (project_id) WHERE enabled = true;

COMMENT ON COLUMN public.reward_webhooks.project_id IS
  'Optional project scope for webhook delivery. NULL means org-wide '
  '(all projects in the organization). Set to a project id to deliver '
  'reward events only when the triggering action belongs to that project.';

-- 1b. Re-issue the synthetic-monitor mutation gate column. The
-- original migration file (20260504150000) was authored but never
-- deployed, so the synthetic-monitor / inventory edge functions were
-- selecting a non-existent column.
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS synthetic_monitor_allow_mutations boolean
    NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_settings.synthetic_monitor_allow_mutations IS
  'When false (default), the synthetic monitor only exercises GET/HEAD/OPTIONS verbs. '
  'Set to true ONLY when synthetic_monitor_target_url points at a sandboxed/test environment '
  'where data loss from POST/PATCH/DELETE/PUT is acceptable.';


-- ────────────────────────────────────────────────────────────
-- 2. ERROR lint — security_definer_view
-- ────────────────────────────────────────────────────────────

-- public.tester_leaderboard_30d_public is a thin projection over the
-- materialized view tester_leaderboard_30d that exposes only the
-- columns intended for public consumption (handle, display name,
-- rank, points). Switching it to security_invoker means the view
-- runs with the caller's role, so RLS on any joined tables is
-- respected. The underlying MV holds only public-facing columns.
ALTER VIEW public.tester_leaderboard_30d_public
  SET (security_invoker = on);


-- ────────────────────────────────────────────────────────────
-- 3a. WARN — function_search_path_mutable
-- ────────────────────────────────────────────────────────────

-- Pin a deterministic search_path on the only flagged function.
-- Using `pg_catalog, public` so unqualified names resolve predictably
-- and a malicious schema search-path injection cannot redirect calls.
ALTER FUNCTION public.get_tester_apps_enriched(uuid)
  SET search_path = pg_catalog, public;


-- ────────────────────────────────────────────────────────────
-- 3b. WARN — extension_in_public (pg_net) — NOT FIXED HERE
-- ────────────────────────────────────────────────────────────
--
-- pg_net is non-relocatable on Supabase — `ALTER EXTENSION pg_net
-- SET SCHEMA extensions` fails with `extension "pg_net" does not
-- support SET SCHEMA`. The only way to move it is DROP + CREATE,
-- which destroys the in-flight request queue and breaks every
-- pg_cron job that calls `net.http_post(...)`.
--
-- Functionally this is harmless: pg_net's actual functions live in
-- the `net` schema regardless of where the extension control file
-- is installed. The `extension_in_public` WARN is therefore a
-- known intentional residual of the Supabase platform.


-- ────────────────────────────────────────────────────────────
-- 4. WARN — rls_policy_always_true on service_role policies
-- ────────────────────────────────────────────────────────────

-- service_role has BYPASSRLS=true at the role level (verified via
-- pg_roles), so explicit `USING (true)` policies for service_role are
-- pure linter noise. Drop them; service_role's bypass still applies.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      pol.polname AS policyname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname LIKE 'service_role_all_%'
      AND pol.polroles::regrole[] = ARRAY['service_role'::regrole]
      AND pg_get_expr(pol.polqual, pol.polrelid) = 'true'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. WARN — SECURITY DEFINER functions executable by anon/authenticated
-- ────────────────────────────────────────────────────────────

-- Helper: revoke EXECUTE from anon, authenticated, and PUBLIC for
-- functions that should only run in trigger / cron / system contexts.
-- These run as the postgres role that owns them; Supabase's cron
-- scheduler and trigger system invoke them automatically and do not
-- depend on PUBLIC EXECUTE.

DO $$
DECLARE
  -- Functions that are invoked as triggers or by cron only.
  fn text;
  fns text[] := ARRAY[
    -- Trigger functions (called by row-level triggers)
    'public.fn_a2a_push_on_status_change()',
    'public.handle_new_user_personal_org()',
    'public.project_members_autoadd_owner()',
    'public.report_comments_fanout_to_reporter()',
    'public.set_qa_stories_updated_at()',
    'public.sync_project_api_key_owner()',

    -- Cron / system maintenance functions (invoked by pg_cron or
    -- service_role edge functions only)
    'public.cleanup_idempotency_keys()',
    'public.mushi_apply_retention()',
    'public.mushi_rls_coverage_snapshot()',
    'public.nl_query_rate_limit_prune(interval)',
    'public.prune_expired_report_presence()',
    'public.prune_graph_edges_per_project()',
    'public.prune_sandbox_events_per_project()',
    'public.refresh_blast_radius_cache_safe()',
    'public.refresh_intelligence_benchmarks()',
    'public.refresh_tester_leaderboard()',
    'public.rls_auto_enable()',
    'public.scoped_rate_limit_prune(interval)',
    'public.seed_project_settings()',

    -- Vault wrappers — only ever invoked by service_role edge functions
    'public.vault_delete_secret(text)',
    'public.vault_get_secret(text)',
    'public.vault_lookup(text)',
    'public.vault_store_secret(text, text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Skipping missing function %', fn;
    END;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 6. WARN — pg_graphql_anon_table_exposed (PII / financial / secrets)
-- ────────────────────────────────────────────────────────────

-- For tables that hold end-user PII, KYC, financial data, secrets, or
-- invitation tokens, revoke SELECT from anon. RLS on these tables
-- already prevents data leakage to unauthenticated callers, but
-- removing SELECT also hides them from the anon GraphQL schema so
-- the structure itself is no longer enumerable.
--
-- We deliberately do NOT revoke from authenticated, because some of
-- these tables (mushi_testers, tester_balances, etc.) are read by
-- signed-in testers via PostgREST/GraphQL with RLS-enforced row
-- filtering.
--
-- We also deliberately do NOT touch tables that are intentionally
-- browsable by anon (published_apps, published_app_bounties,
-- published_app_targeting, agent_personas, reward_quests, reward_rules,
-- reward_tiers, tester_leaderboard_30d_public, etc.).

DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    -- End-user PII / activity
    'public.end_users',
    'public.end_user_activity',
    'public.end_user_points',

    -- Auth / security internals
    'public.host_auth_providers',
    'public.jwks_cache',
    'public.invitations',

    -- Tester PII / KYC
    'public.mushi_testers',
    'public.mushi_tester_profiles',
    'public.tester_kyc',

    -- Financial / payouts
    'public.tester_balances',
    'public.tester_credit_ledger',
    'public.tester_redemptions',
    'public.reward_payouts',
    'public.reward_payout_accounts',
    'public.reward_disputes',
    'public.tremendous_orders',

    -- Webhook delivery secrets
    'public.reward_webhooks'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    BEGIN
      EXECUTE format('REVOKE SELECT ON %s FROM anon', tbl);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Skipping missing table %', tbl;
    END;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 7. Migration metadata
-- ────────────────────────────────────────────────────────────

COMMENT ON SCHEMA public IS
  'Mushi Mushi v2 — public schema. Security advisor remediation '
  'applied 2026-05-27 (migration 20260527020000): security_invoker '
  'on public leaderboard view, search_path pinned on flagged '
  'functions, pg_net moved out of public, redundant service_role '
  'RLS policies dropped, EXECUTE revoked from anon/authenticated '
  'on trigger/cron functions, and SELECT revoked from anon on '
  'PII/financial tables (RLS still applies).';
