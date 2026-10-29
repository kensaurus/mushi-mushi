-- ============================================================================
-- 20261028190000_studio_cost_floor
--
-- A diagnosis on Mushi's own AI key costs about $0.017-0.022 (llm_invocations,
-- 30 days to 2026-10-28: triage ~$0.017 per report plus quality grading).
-- Studio at $79 with 5,000 included and $0.02 overage lost money at full use
-- (5,000 x $0.022 = $110) and on every extra diagnosis. Studio now includes
-- 3,000 (worst case ~$66 against ~$76 after card fees) and charges $0.03 per
-- extra, like Builder. The Stripe overage price mushi:diagnoses:overage:pro:v4
-- (3,000 at $0, then 3 cents) replaces v3, which is archived; no subscriber
-- was on it.
-- ============================================================================
UPDATE public.pricing_plans SET
  included_diagnoses_per_month = 3000,
  overage_unit_amount_decimal_diagnoses = 0.03,
  overage_price_lookup_key = 'mushi:diagnoses:overage:pro:v4'
WHERE id = 'pro';
