-- ============================================================================
-- 20261028180000_plans_free_builder_studio
--
-- The pricing plan the owner approved on 2026-10-28 (docs/plan-pricing.md):
-- the value metric is apps watched, diagnoses are the allowance under it, and
-- a vibe coder can reach a fix PR on Free with their own key.
--
-- Plan ids stay as they are (orgs, subscriptions, webhooks, RPCs and ~60 code
-- paths key on them); only what each plan is changes:
--
--   id          name        price            apps  diagnoses (then)         retention  seats
--   free_cloud  Free        $0               1     100 (hard stop)          14 days    1
--   indie       Builder     $29/mo, $290/yr  3     1,000 (then $0.03)       90 days    1
--   pro         Studio      $79/mo, $790/yr  10    5,000 (then $0.02)       180 days   5
--   enterprise  Enterprise  from $499/mo     any   unlimited                365 days   any
--
-- * One meter: reports are no longer a billed allowance (included_reports and
--   the per-report overage go to NULL); diagnoses are the only metered unit.
-- * Bring your own key on every plan, Free included: the fix PR and its review
--   run on the person's own Anthropic / Cursor key, so Free can show the whole
--   loop once. The upgrade is a second app or automation, not the key.
-- * pricing_plans.max_projects: apps an organization may create on the plan
--   (NULL = no limit), checked by POST /v1/admin/projects.
-- * Sign-ups were placed on the retired Hobby plan (organizations.plan_id
--   defaulted to 'hobby', 1,000 diagnoses, no BYOK), so the catalog never
--   described what a free user got. New organizations get free_cloud, and the
--   organizations still on hobby move to it. Hobby and Starter stay inactive
--   rows (FK targets for history) and mirror Free.
-- * New Stripe lookup keys for the new prices (created with matching keys and
--   metadata tier = the plan id; STRIPE_PRICE_* secrets point at them).
--   No subscription exists on the old prices (0 rows in billing_subscriptions
--   on 2026-10-28), so nothing is grandfathered.
-- ============================================================================

ALTER TABLE public.pricing_plans
  ADD COLUMN IF NOT EXISTS max_projects integer CHECK (max_projects IS NULL OR max_projects >= 1);

COMMENT ON COLUMN public.pricing_plans.max_projects IS
  'Apps (projects) an organization on this plan may create; NULL = no limit. Checked by POST /v1/admin/projects (docs/plan-pricing.md, 2026-10-28).';

UPDATE public.pricing_plans SET
  display_name = 'Free',
  monthly_price_usd = 0,
  included_reports_per_month = NULL,
  overage_unit_amount_decimal = NULL,
  overage_price_lookup_key = NULL,
  included_diagnoses_per_month = 100,
  overage_unit_amount_decimal_diagnoses = NULL,
  monthly_spend_cap_usd = NULL,
  retention_days = 14,
  seat_limit = 1,
  max_projects = 1,
  feature_flags = feature_flags || '{"byok": true}'::jsonb
WHERE id = 'free_cloud';

UPDATE public.pricing_plans SET
  display_name = 'Builder',
  monthly_price_usd = 29,
  base_price_lookup_key = 'mushi:indie:base:v2',
  overage_price_lookup_key = 'mushi:diagnoses:overage:indie:v3',
  included_reports_per_month = NULL,
  overage_unit_amount_decimal = NULL,
  included_diagnoses_per_month = 1000,
  overage_unit_amount_decimal_diagnoses = 0.03,
  monthly_spend_cap_usd = 50,
  retention_days = 90,
  seat_limit = 1,
  max_projects = 3
WHERE id = 'indie';

UPDATE public.pricing_plans SET
  display_name = 'Studio',
  monthly_price_usd = 79,
  base_price_lookup_key = 'mushi:pro:base:v3',
  overage_price_lookup_key = 'mushi:diagnoses:overage:pro:v3',
  included_reports_per_month = NULL,
  overage_unit_amount_decimal = NULL,
  included_diagnoses_per_month = 5000,
  overage_unit_amount_decimal_diagnoses = 0.02,
  monthly_spend_cap_usd = 200,
  retention_days = 180,
  seat_limit = 5,
  max_projects = 10
WHERE id = 'pro';

UPDATE public.pricing_plans SET
  display_name = 'Enterprise',
  monthly_price_usd = 499,
  included_reports_per_month = NULL,
  overage_unit_amount_decimal = NULL,
  max_projects = NULL
WHERE id = 'enterprise';

-- Retired rows mirror Free, so any organization or code path still naming
-- them gets the Free plan, not 1,000 diagnoses without a key.
UPDATE public.pricing_plans p SET
  included_reports_per_month = NULL,
  overage_unit_amount_decimal = NULL,
  included_diagnoses_per_month = f.included_diagnoses_per_month,
  overage_unit_amount_decimal_diagnoses = NULL,
  retention_days = f.retention_days,
  seat_limit = f.seat_limit,
  max_projects = f.max_projects,
  feature_flags = f.feature_flags,
  active = false
FROM public.pricing_plans f
WHERE f.id = 'free_cloud' AND p.id IN ('hobby', 'starter');

ALTER TABLE public.organizations ALTER COLUMN plan_id SET DEFAULT 'free_cloud';

UPDATE public.organizations SET plan_id = 'free_cloud', updated_at = now()
WHERE plan_id = 'hobby';
