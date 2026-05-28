-- Migration: marketplace_entitlements
-- PURPOSE: Wave 1 — adds the three new feature flags for the Mushi Bounties
--   marketplace to pricing_plans.feature_flags, updates project_settings
--   with marketplace budget / tester cap columns, and adds a helper RPC
--   to check the marketplace publish budget.

-- ── pricing_plans.feature_flags — new marketplace flags ───────────────────
-- Existing flags: sso, byok, plugins, intelligence_reports, audit_log, soc2,
--   self_hosted, teams, inventory_v2, rewards_program, rewards_monetary.
-- New flags added here:
--   marketplace_publish       — can publish an app to the Bounties marketplace
--   tester_cashout            — enables gift-card redemptions on the dev side
--                               (funds the Tremendous balance for this project)
--   marketplace_priority_listing — app appears at the top of the browse page

-- pricing_plans uses `id` as the plan slug (hobby, starter, pro, enterprise).
-- Pro gets marketplace_publish + tester_cashout.
UPDATE public.pricing_plans
   SET feature_flags = feature_flags
     || '{"marketplace_publish": true, "tester_cashout": true, "marketplace_priority_listing": false}'::jsonb
 WHERE id = 'pro';

-- Enterprise gets all three (priority listing = true).
UPDATE public.pricing_plans
   SET feature_flags = feature_flags
     || '{"marketplace_publish": true, "tester_cashout": true, "marketplace_priority_listing": true}'::jsonb
 WHERE id = 'enterprise';

-- Hobby + Starter get all three as false.
UPDATE public.pricing_plans
   SET feature_flags = feature_flags
     || '{"marketplace_publish": false, "tester_cashout": false, "marketplace_priority_listing": false}'::jsonb
 WHERE id IN ('hobby', 'starter');

-- ── project_settings — marketplace budget columns ────────────────────────
-- marketplace_published_app_id: FK to published_apps set once the project
--   publishes its first listing. Used by the sidebar nudge check.
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS marketplace_published_app_id uuid
    REFERENCES public.published_apps(id) ON DELETE SET NULL;

-- marketplace_monthly_budget_usd: the ceiling on Tremendous gift-card spend
--   funded by this project's subscription. 0 = no budget (cash-out disabled).
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS marketplace_monthly_budget_usd numeric
    NOT NULL DEFAULT 0 CHECK (marketplace_monthly_budget_usd >= 0);

-- marketplace_max_testers: how many testers may be simultaneously active on
--   this project's published app. 0 = unlimited.
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS marketplace_max_testers int
    NOT NULL DEFAULT 100 CHECK (marketplace_max_testers >= 0);

-- ── check_marketplace_budget RPC ─────────────────────────────────────────
-- Returns budget stats for the active billing month. Used by the gift-card
-- redemption handler to enforce the per-project ceiling.
CREATE OR REPLACE FUNCTION public.check_marketplace_budget(
  p_project_id uuid,
  p_requested_amount_usd numeric
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  WITH settings AS (
    SELECT marketplace_monthly_budget_usd AS cap
      FROM public.project_settings
     WHERE project_id = p_project_id
  ),
  spent AS (
    SELECT COALESCE(SUM(tr.face_value_usd), 0) AS paid_this_month
      FROM public.tester_redemptions tr
      JOIN public.tester_app_subscriptions tas ON tas.tester_id = tr.tester_id
      JOIN public.published_apps pa ON pa.id = tas.app_id AND pa.project_id = p_project_id
     WHERE tr.kind = 'gift_card'
       AND tr.status IN ('complete', 'processing', 'pending')
       AND tr.requested_at >= date_trunc('month', now())
  )
  SELECT jsonb_build_object(
    'cap',            s.cap,
    'paid_this_month', sp.paid_this_month,
    'headroom',       GREATEST(0, s.cap - sp.paid_this_month),
    'would_exceed',   (sp.paid_this_month + p_requested_amount_usd) > s.cap AND s.cap > 0,
    'pct_used',       CASE WHEN s.cap > 0
                           THEN ROUND((sp.paid_this_month / s.cap) * 100, 1)
                           ELSE 0 END
  )
  FROM settings s, spent sp;
$$;

COMMENT ON FUNCTION public.check_marketplace_budget IS
  'Returns budget stats for the active billing month for a project. '
  'Returns would_exceed=true if adding p_requested_amount_usd would bust '
  'the project cap. cap=0 means unlimited (but tester_cashout entitlement '
  'is still required).';
