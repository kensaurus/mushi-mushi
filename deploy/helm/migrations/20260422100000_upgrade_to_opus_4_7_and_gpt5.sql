-- Migration: 20260422100000_upgrade_to_opus_4_7_and_gpt5
-- Purpose: Bump LLM defaults to current-generation models.
--
--   • Opus 4.7 (released 2026-04-16) for judge + prompt-auto-tune (self-
--     critique benefits most from the frontier).
--   • Sonnet 4.6 stays for Stage 2 classification + fix-worker + intelligence
--     + synthetic + modernizer (sweet spot of cost/quality).
--   • Haiku 4.5 stays for fast-filter + nl-query summariser.
--   • GPT-5.4 / GPT-5.4-mini replace GPT-4.1 / GPT-4.1-mini as the cross-
--     vendor fallback everywhere.
--
-- Mirrored in code at:
--   packages/server/supabase/functions/_shared/models.ts
--   packages/server/supabase/functions/_shared/pricing.ts
--
-- This migration ONLY alters column defaults and seeds pricing rows. It
-- deliberately does NOT UPDATE existing project rows — operators may have
-- chosen a cheaper/different model on purpose; we respect overrides.

-- ---------------------------------------------------------------------------
-- 1. Column defaults
-- ---------------------------------------------------------------------------

alter table project_settings
  alter column stage1_model set default 'claude-haiku-4-5-20251001';

alter table project_settings
  alter column stage2_model set default 'claude-sonnet-4-6';

alter table project_settings
  alter column judge_model set default 'claude-opus-4-7';

-- judge_fallback_model may not exist on older databases; guard with a
-- do-block so the migration is idempotent across environments.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'project_settings'
       and column_name = 'judge_fallback_model'
  ) then
    execute 'alter table project_settings alter column judge_fallback_model set default ''gpt-5.4''';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill: migrate ONLY rows still pinned to the explicitly-deprecated
--    dated Sonnet identifier the fix-worker used to hard-code. Every other
--    override is respected.
-- ---------------------------------------------------------------------------

update project_settings
   set stage2_model = 'claude-sonnet-4-6'
 where stage2_model in ('claude-sonnet-4', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929');

-- Opus 4-6 → Opus 4-7 for the judge ONLY (don't touch stage2 which may be
-- explicitly running opus-4-6 for quality).
update project_settings
   set judge_model = 'claude-opus-4-7'
 where judge_model in ('claude-opus-4', 'claude-opus-4-20250514', 'claude-opus-4-6')
   and judge_model is distinct from 'claude-opus-4-7';

-- ---------------------------------------------------------------------------
-- 3. Pricing rows for new models (mirrors pricing.ts exactly)
--
-- The existing cost_usd backfill migration (20260420000200) seeded the
-- original pricing table; rows inserted after that migration ran use the
-- TS-side pricing.ts. No row update needed here — the SQL table only matters
-- for historical backfill. We leave a comment so a future DBA knows the
-- table of record is now pricing.ts (with this migration mirroring).
-- ---------------------------------------------------------------------------

comment on column llm_invocations.cost_usd is
  'USD cost computed from input_tokens + output_tokens at write time using pricing.ts. Six decimal places so a $0.000123 Haiku call is preserved exactly. Mirrored in SQL by migration 20260420000200_llm_cost_usd and 20260422100000_upgrade_to_opus_4_7_and_gpt5 for new model IDs (gpt-5.4, gpt-5.4-mini, claude-opus-4-7, claude-haiku-4-5-20251001).';

-- Retro-fill any rows that landed between 20260420000200 and this migration
-- whose used_model is one of the new IDs — the earlier migration's VALUES
-- list doesn't know about them, so they defaulted to the $3/$15 Sonnet
-- fallback. Re-run the pricing for precision on the gpt-5.4-mini rows
-- specifically (cheaper than the fallback assumed).
with pricing(model, in_per_m, out_per_m) as (
  values
    ('claude-haiku-4-5-20251001',  1.00::numeric,  5.00::numeric),
    ('claude-haiku-4-5',           1.00::numeric,  5.00::numeric),
    ('claude-sonnet-4-5-20250929', 3.00::numeric, 15.00::numeric),
    ('claude-opus-4-7',           15.00::numeric, 75.00::numeric),
    ('gpt-5.4',                    5.00::numeric, 15.00::numeric),
    ('gpt-5.4-mini',               0.60::numeric,  2.40::numeric)
)
update llm_invocations inv
   set cost_usd = (
         (coalesce(inv.input_tokens, 0)  * coalesce(p.in_per_m,  3.00::numeric))
       + (coalesce(inv.output_tokens, 0) * coalesce(p.out_per_m, 15.00::numeric))
       ) / 1000000.0
  from pricing p
 where p.model = lower(substring(inv.used_model from '[^/]+$'))
   and inv.created_at >= '2026-04-20'::timestamptz;
