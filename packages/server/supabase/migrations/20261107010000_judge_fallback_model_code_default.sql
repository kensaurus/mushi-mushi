-- judge_fallback_model defaulted to 'gpt-5.4' (20260422100000) and before that
-- to 'gpt-4.1' (20260418000100). Every project copied the default, so the
-- judge's OpenAI path never used JUDGE_FALLBACK in _shared/models.ts: on an
-- OpenAI organization it graded fixes with GPT-5.4 ($5/$15 per MTok).
--
-- NULL now means "use the code default" (judge-batch reads
-- `settings.judge_fallback_model ?? JUDGE_FALLBACK`), which is GPT-6.1 Terra
-- ($1/$5) from 2026-11-07. Only rows still holding one of the two old
-- defaults are cleared; any other value was chosen on purpose and stays.

alter table public.project_settings alter column judge_fallback_model drop default;

update public.project_settings
   set judge_fallback_model = null
 where judge_fallback_model in ('gpt-5.4', 'gpt-4.1');
