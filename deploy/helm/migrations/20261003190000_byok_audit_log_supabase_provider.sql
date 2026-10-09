-- Let the BYOK audit log record Supabase access tokens.
--
-- 20260611150000 added 'supabase' to byok_keys.provider_slug, but
-- byok_audit_log.provider (20260806035756) still lists only the five LLM and
-- crawler providers. Adding, testing or removing a Supabase token from the
-- console would then drop its audit rows: the insert is best-effort, so the
-- CHECK violation is swallowed and nothing records who linked the project.
--
-- Additive: it widens the allowed set and rejects nothing that passed before.
-- Apply before deploying the `api` function that accepts the supabase slug.

ALTER TABLE public.byok_audit_log
  DROP CONSTRAINT IF EXISTS byok_audit_log_provider_check;

ALTER TABLE public.byok_audit_log
  ADD CONSTRAINT byok_audit_log_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'firecrawl', 'browserbase', 'cursor', 'supabase'));

NOTIFY pgrst, 'reload schema';
