-- Migration: 20260621111500_pricing_plans_lookup_keys.sql
-- PURPOSE: Set base_price_lookup_key + overage_price_lookup_key on the new
--   diagnoses-metered tiers so stripe-webhooks can resolve plan_id from a
--   Checkout Session's line-item price without relying solely on metadata.
--
-- Note: free_cloud has no Stripe price (free tier, no card required) so its
--   lookup keys stay NULL. The indie and pro v2 prices are created by
--   stripe-bootstrap.mjs; run that script first (or concurrently in the same
--   bootstrap pass) to mint the prices.

-- ── Indie tier ────────────────────────────────────────────────────────────
-- Checkout Sessions for Indie pass plan_id='indie' in metadata (primary
-- resolution path). This lookup key is the fallback used by
-- stripe-webhooks.resolvePlanId when metadata is absent.
UPDATE pricing_plans SET
  base_price_lookup_key    = 'mushi:indie:base:v1',
  overage_price_lookup_key = 'mushi:diagnoses:overage:indie:v1',
  updated_at               = now()
WHERE id = 'indie';

-- ── Pro tier — add v2 as the active lookup key ───────────────────────────
-- Existing subscribers on mushi:pro:base:v1 will have plan_id='pro' stored
-- in billing_subscriptions already (set at checkout time via metadata), so
-- changing base_price_lookup_key here does not affect their billing. New Pro
-- subscribers signed up via the $49 v2 price will resolve cleanly.
UPDATE pricing_plans SET
  base_price_lookup_key    = 'mushi:pro:base:v2',
  overage_price_lookup_key = 'mushi:diagnoses:overage:pro:v1',
  updated_at               = now()
WHERE id = 'pro';

-- ── Verify ────────────────────────────────────────────────────────────────
-- The CI schema-gate test checks no required columns are NULL on active plans.
-- Run this manually to confirm after the migration applies:
--
--   SELECT id, base_price_lookup_key, overage_price_lookup_key
--   FROM pricing_plans
--   WHERE id IN ('indie', 'pro', 'free_cloud', 'enterprise');
