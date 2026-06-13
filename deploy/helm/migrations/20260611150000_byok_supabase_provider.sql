-- Allow a Supabase Personal Access Token to be stored in the BYOK key pool.
-- The backend-inspection features (Schema-Repair Diagnostic card,
-- backend-drift-scanner) resolve this PAT via resolveSupabasePat() under the
-- slug 'supabase'. Without this the provider_slug CHECK rejects inserts and the
-- feature can never be configured.
ALTER TABLE byok_keys DROP CONSTRAINT IF EXISTS byok_keys_provider_slug_check;
ALTER TABLE byok_keys ADD CONSTRAINT byok_keys_provider_slug_check CHECK (
  provider_slug IN ('anthropic', 'openai', 'firecrawl', 'browserbase', 'cursor', 'supabase')
);
