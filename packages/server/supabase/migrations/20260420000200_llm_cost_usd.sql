-- Migration: 20260420000200_llm_cost_usd
-- Purpose:   Wave J §1 — promote LLM cost from a frontend-side estimate to a
--            first-class column on `llm_invocations`. Two reasons it matters:
--              1. Health, Billing, and Prompt Lab all need the SAME number
--                 (single source of truth) — Wave I had three different
--                 estimators drifting apart.
--              2. We want $-spent-per-project rolled into Billing so customers
--                 can see their actual COGS alongside report quota usage.
--
-- The pricing table inside this migration MUST stay in sync with
-- `packages/server/supabase/functions/_shared/pricing.ts` — both render
-- USD per 1M tokens. Update both when adding a model.

ALTER TABLE llm_invocations
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6);

COMMENT ON COLUMN llm_invocations.cost_usd IS
  'USD cost computed from input_tokens + output_tokens at write time using pricing.ts. Six decimal places so a $0.000123 Haiku call is preserved exactly. Nullable for historical rows that predate the column — those are backfilled below.';

-- Index the column we actually aggregate on so the new
-- /v1/admin/billing per-project monthly $ rollup stays index-only.
-- Partial: cost_usd is null for ancient rows; we only ever aggregate the
-- populated set, and the partial keeps the index small.
CREATE INDEX IF NOT EXISTS idx_llm_inv_project_cost
  ON llm_invocations (project_id, created_at DESC)
  WHERE cost_usd IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Backfill: estimate cost for every existing row using the same pricing table
-- the TS code uses. Mirror exactly — drift here means Health rollup numbers
-- jump the moment new writes start landing.
--
-- Vendor-prefix stripping (`anthropic/claude-...` -> `claude-...`) is done via
-- substring(used_model from '[^/]+$'). Default fallback is Sonnet pricing,
-- matching LLM_PRICING_FALLBACK in pricing.ts.
-- ----------------------------------------------------------------------------
WITH pricing(model, in_per_m, out_per_m) AS (
  VALUES
    ('claude-haiku-4-6',           0.25::numeric,  1.25::numeric),
    ('claude-haiku-3-5',           0.80::numeric,  4.00::numeric),
    ('claude-sonnet-4-6',          3.00::numeric, 15.00::numeric),
    ('claude-sonnet-3-7',          3.00::numeric, 15.00::numeric),
    ('claude-opus-4-6',           15.00::numeric, 75.00::numeric),
    ('gpt-4.1',                    2.00::numeric,  8.00::numeric),
    ('gpt-4.1-mini',               0.40::numeric,  1.60::numeric),
    ('gpt-5',                      5.00::numeric, 15.00::numeric),
    ('text-embedding-3-small',     0.02::numeric,  0.00::numeric),
    ('text-embedding-3-large',     0.13::numeric,  0.00::numeric)
)
UPDATE llm_invocations inv
   SET cost_usd = (
         (COALESCE(inv.input_tokens, 0)  * COALESCE(p.in_per_m,  3.00::numeric))
       + (COALESCE(inv.output_tokens, 0) * COALESCE(p.out_per_m, 15.00::numeric))
       ) / 1000000.0
  FROM pricing p
 WHERE inv.cost_usd IS NULL
   AND p.model = lower(substring(inv.used_model FROM '[^/]+$'));

-- Second pass: rows whose model isn't in the pricing table fall back to the
-- Sonnet rate (matches LLM_PRICING_FALLBACK in pricing.ts). Run after the
-- table-driven backfill so unknown-model rows are still populated.
UPDATE llm_invocations
   SET cost_usd = (
         (COALESCE(input_tokens, 0)  *  3.00::numeric)
       + (COALESCE(output_tokens, 0) * 15.00::numeric)
       ) / 1000000.0
 WHERE cost_usd IS NULL;
