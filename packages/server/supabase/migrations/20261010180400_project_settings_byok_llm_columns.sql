-- ============================================================================
-- 20261010180400_project_settings_byok_llm_columns
--
-- _shared/byok.ts resolveLlmKey selects byok_openai_base_url and
-- byok_<provider>_test_status for anthropic/openai, and the key-test route
-- writes byok_<provider>_test_status / _tested_at. The hosted project has
-- these columns, added outside the migration history, so a database built
-- from these migrations (self-host, Helm) errored on that select and BYOK
-- fell back to the platform key. Types match the hosted project (plain text
-- and timestamptz, nullable, no CHECK). Firecrawl and Browserbase already
-- have theirs (20260418005000 and later).
-- ============================================================================

alter table public.project_settings
  add column if not exists byok_openai_base_url       text,
  add column if not exists byok_openai_test_status    text,
  add column if not exists byok_openai_tested_at      timestamptz,
  add column if not exists byok_anthropic_test_status text,
  add column if not exists byok_anthropic_tested_at   timestamptz;
