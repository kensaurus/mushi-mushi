-- Enterprise is sales-led again (owner decision 2026-10-10: "Contact us").
--
-- The seed (20260419000000_billing_plans) shipped Enterprise with
-- is_self_serve = FALSE. On 2026-08-08 the live row was flipped to
-- self-serve out of band with a proposed $499/mo Stripe price, so the
-- console offered "Switch to Enterprise" and checkout sold it. That price
-- is archived in Stripe; this restores the seed's sales-led posture.
--
-- monthly_price_usd stays as it is: the retention sweep reads 0 as a free
-- plan, and the console never shows a price for a sales-led plan.
-- The checkout route also refuses Enterprise in code
-- (_shared/billing-rules.ts isSalesLedPlan), so a future drift of this row
-- cannot reopen it.

UPDATE public.pricing_plans
SET is_self_serve = FALSE,
    base_price_lookup_key = NULL
WHERE id = 'enterprise';
