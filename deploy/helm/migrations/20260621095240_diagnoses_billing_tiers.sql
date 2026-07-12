-- Migration: 20260621101500_diagnoses_billing_tiers.sql
-- PURPOSE: Phase 2 — restructure pricing_plans to the new diagnoses-metered tiers:
--   Free Cloud ($0/50) · Indie ($15/500) · Pro ($49/2,000) · Enterprise (custom).
--   Adds included_diagnoses_per_month, overage_unit_amount_decimal_diagnoses,
--   and monthly_spend_cap_usd columns to pricing_plans; adds
--   monthly_spend_cap_usd_override to billing_subscriptions so users can set
--   their own per-subscription hard cap.
--   Legacy hobby/starter rows are deactivated (not deleted) so existing
--   subscriptions referencing them don't break mid-cycle.

-- ── 1. New columns on pricing_plans ──────────────────────────────────────────

ALTER TABLE pricing_plans
  ADD COLUMN IF NOT EXISTS included_diagnoses_per_month bigint,
  ADD COLUMN IF NOT EXISTS overage_unit_amount_decimal_diagnoses numeric(20, 6),
  ADD COLUMN IF NOT EXISTS monthly_spend_cap_usd numeric(10, 2);

COMMENT ON COLUMN pricing_plans.included_diagnoses_per_month IS
  'Diagnoses quota included in the base monthly price. NULL = unlimited (Enterprise / self-host).';

COMMENT ON COLUMN pricing_plans.overage_unit_amount_decimal_diagnoses IS
  'USD charged per diagnosis above included_diagnoses_per_month. NULL = no overage allowed (hard stop).';

COMMENT ON COLUMN pricing_plans.monthly_spend_cap_usd IS
  'Default plan-level hard spend cap in USD. billing_subscriptions.monthly_spend_cap_usd_override takes precedence when set.';

-- ── 2. Per-subscription cap override on billing_subscriptions ────────────────

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS monthly_spend_cap_usd_override numeric(10, 2);

COMMENT ON COLUMN billing_subscriptions.monthly_spend_cap_usd_override IS
  'User-set hard spend cap for this subscription. Overrides pricing_plans.monthly_spend_cap_usd when non-null.';

-- ── 3. Insert new tiers (idempotent) ─────────────────────────────────────────
-- Free Cloud: replaces Hobby. Hard stop at 50 diagnoses, no overage.
INSERT INTO pricing_plans (
  id, display_name, position, monthly_price_usd,
  included_reports_per_month, included_diagnoses_per_month,
  overage_unit_amount_decimal, overage_unit_amount_decimal_diagnoses,
  retention_days, seat_limit, is_self_serve, active, feature_flags
)
VALUES (
  'free_cloud', 'Free Cloud', 10, 0.00,
  NULL, 50,
  NULL, NULL,
  7, 1, true, true,
  '{"plugin_marketplace": false, "email_support": false, "sso": false, "soc2": false, "usage_alerts": false}'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  position = EXCLUDED.position,
  monthly_price_usd = EXCLUDED.monthly_price_usd,
  included_diagnoses_per_month = EXCLUDED.included_diagnoses_per_month,
  overage_unit_amount_decimal_diagnoses = EXCLUDED.overage_unit_amount_decimal_diagnoses,
  retention_days = EXCLUDED.retention_days,
  seat_limit = EXCLUDED.seat_limit,
  active = EXCLUDED.active,
  feature_flags = EXCLUDED.feature_flags,
  updated_at = now();

-- Indie: replaces Starter. 500 diagnoses/mo, $0.03 per overage, user-settable cap.
INSERT INTO pricing_plans (
  id, display_name, position, monthly_price_usd,
  included_reports_per_month, included_diagnoses_per_month,
  overage_unit_amount_decimal, overage_unit_amount_decimal_diagnoses,
  monthly_spend_cap_usd,
  retention_days, seat_limit, is_self_serve, active, feature_flags
)
VALUES (
  'indie', 'Indie', 11, 15.00,
  NULL, 500,
  NULL, 0.030000,
  50.00,
  30, 1, true, true,
  '{"plugin_marketplace": true, "email_support": true, "sso": false, "soc2": false, "usage_alerts": true, "spend_cap": true}'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  position = EXCLUDED.position,
  monthly_price_usd = EXCLUDED.monthly_price_usd,
  included_diagnoses_per_month = EXCLUDED.included_diagnoses_per_month,
  overage_unit_amount_decimal_diagnoses = EXCLUDED.overage_unit_amount_decimal_diagnoses,
  monthly_spend_cap_usd = EXCLUDED.monthly_spend_cap_usd,
  retention_days = EXCLUDED.retention_days,
  seat_limit = EXCLUDED.seat_limit,
  active = EXCLUDED.active,
  feature_flags = EXCLUDED.feature_flags,
  updated_at = now();

-- ── 4. Update existing tiers in-place ────────────────────────────────────────
-- Pro: new price $49, 2,000 diagnoses, 5 seats. Keep plan_id 'pro' for existing subs.
UPDATE pricing_plans SET
  display_name = 'Pro',
  monthly_price_usd = 49.00,
  included_diagnoses_per_month = 2000,
  overage_unit_amount_decimal_diagnoses = 0.025000,
  monthly_spend_cap_usd = 200.00,
  retention_days = 90,
  seat_limit = 5,
  feature_flags = '{"plugin_marketplace": true, "email_support": true, "sso": false, "soc2": false, "usage_alerts": true, "spend_cap": true, "shared_views": true}',
  updated_at = now()
WHERE id = 'pro';

-- Enterprise: add diagnoses columns (unlimited).
UPDATE pricing_plans SET
  included_diagnoses_per_month = NULL,
  overage_unit_amount_decimal_diagnoses = NULL,
  monthly_spend_cap_usd = NULL,
  feature_flags = '{"plugin_marketplace": true, "email_support": true, "sso": true, "soc2": true, "usage_alerts": true, "spend_cap": true, "shared_views": true, "scim": true, "data_residency": true}',
  updated_at = now()
WHERE id = 'enterprise';

-- ── 5. Deactivate legacy tiers (no delete — existing subs reference them) ─────
UPDATE pricing_plans SET
  active = false,
  updated_at = now()
WHERE id IN ('hobby', 'starter');

-- Backfill included_diagnoses_per_month on legacy rows so quota.ts never sees NULL.
UPDATE pricing_plans SET
  included_diagnoses_per_month = 1000,
  overage_unit_amount_decimal_diagnoses = NULL
WHERE id = 'hobby' AND included_diagnoses_per_month IS NULL;

UPDATE pricing_plans SET
  included_diagnoses_per_month = 10000,
  overage_unit_amount_decimal_diagnoses = 0.003000
WHERE id = 'starter' AND included_diagnoses_per_month IS NULL;
