-- The v1 diagnoses overage prices were flat per-unit, and usage-aggregator
-- sends every diagnosis to the meter, so a subscriber would have paid
-- $0.03 / $0.025 for the 500 / 2,000 diagnoses the plan includes. The v2
-- prices are graduated with a $0 first tier up to the included amount
-- (created live 2026-10-09; STRIPE_PRICE_*_DIAGNOSES_OVERAGE now point at
-- them). Keep the catalog's lookup keys in step. No subscriber was on v1.
update public.pricing_plans
   set overage_price_lookup_key = 'mushi:diagnoses:overage:indie:v2'
 where id = 'indie'
   and overage_price_lookup_key = 'mushi:diagnoses:overage:indie:v1';

update public.pricing_plans
   set overage_price_lookup_key = 'mushi:diagnoses:overage:pro:v2'
 where id = 'pro'
   and overage_price_lookup_key = 'mushi:diagnoses:overage:pro:v1';
