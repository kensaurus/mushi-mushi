-- Migration: 20261002090000_stage2_judge_sonnet_5_5
-- Purpose: Move Stage 2 classification and the nightly judge to Claude
-- Sonnet 5.5 ($2 / $10 per MTok).
--
-- Mirrored in code at:
--   packages/server/supabase/functions/_shared/models.ts   (STAGE2_MODEL, JUDGE_MODEL)
--   packages/server/supabase/functions/_shared/pricing.ts
--   apps/admin/src/components/settings/GeneralPanel.tsx    (picker default)
--
-- WHY THIS ONE UPDATES ROWS (unlike 20260422100000)
--   classify-report and judge-batch read `project_settings.stage2_model` /
--   `judge_model` first and only fall back to the code default when the
--   column is NULL. The column defaults filled every row at insert time, so
--   on 2026-10-02 all 12 projects held exactly the old defaults
--   (`claude-sonnet-4-6`, `claude-opus-4-7`) and changing the code default
--   alone would move nobody. The UPDATEs below touch ONLY rows still equal to
--   the previous default; any other explicit choice is left alone.
--   (A project that deliberately picked the old default value cannot be told
--   apart from one that never chose; such an operator can pick it again in
--   Settings → General.)
--
-- Requires the edge functions that call Claude through `claude-messages.ts`
-- (classify-report, judge-batch, test-gen-from-report) to be deployed FIRST:
-- the AI SDK v4 path they replace sends `temperature: 0` and a forced
-- `tool_choice`, which Sonnet 5.5 rejects with a 400.

alter table public.project_settings
  alter column stage2_model set default 'claude-sonnet-5-5';

alter table public.project_settings
  alter column judge_model set default 'claude-sonnet-5-5';

update public.project_settings
   set stage2_model = 'claude-sonnet-5-5'
 where stage2_model = 'claude-sonnet-4-6';

update public.project_settings
   set judge_model = 'claude-sonnet-5-5'
 where judge_model = 'claude-opus-4-7';
