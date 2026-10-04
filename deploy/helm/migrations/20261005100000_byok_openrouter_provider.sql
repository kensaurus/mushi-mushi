-- OpenRouter becomes its own BYOK provider (2026-10-05).
--
-- Until now an OpenRouter key was stored as provider 'openai' with
-- base_url https://openrouter.ai/api/v1. It then served every OpenAI call,
-- including ones OpenRouter cannot (speech-to-text, fine-tuning) and ones
-- that sent it to api.openai.com, which 401s and marks the key auth_failed;
-- OpenRouter also rejects OpenAI's bare model ids. As its own provider the
-- key is resolved only where it works (_shared/byok.ts), with vendor-prefixed
-- model ids (_shared/openai-compat.ts).
--
-- Additive only: the CHECKs accept 'openrouter'. Rows move in
-- 20261005100100 once the code that reads 'openrouter' is deployed.

ALTER TABLE public.byok_keys DROP CONSTRAINT IF EXISTS byok_keys_provider_slug_check;
ALTER TABLE public.byok_keys ADD CONSTRAINT byok_keys_provider_slug_check
  CHECK (provider_slug IN ('anthropic', 'openai', 'openrouter', 'firecrawl', 'browserbase', 'cursor', 'supabase'));

ALTER TABLE public.byok_audit_log DROP CONSTRAINT IF EXISTS byok_audit_log_provider_check;
ALTER TABLE public.byok_audit_log ADD CONSTRAINT byok_audit_log_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'openrouter', 'firecrawl', 'browserbase', 'cursor', 'supabase'));
