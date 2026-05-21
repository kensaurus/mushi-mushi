-- Display-only masked hints for configured BYOK keys (never store full secrets).
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS byok_anthropic_key_hint TEXT,
  ADD COLUMN IF NOT EXISTS byok_openai_key_hint TEXT,
  ADD COLUMN IF NOT EXISTS byok_firecrawl_key_hint TEXT;

COMMENT ON COLUMN project_settings.byok_anthropic_key_hint IS
  'Masked display hint for the Anthropic BYOK key (prefix…suffix). Not the secret.';
COMMENT ON COLUMN project_settings.byok_openai_key_hint IS
  'Masked display hint for the OpenAI-compatible BYOK key (prefix…suffix). Not the secret.';
COMMENT ON COLUMN project_settings.byok_firecrawl_key_hint IS
  'Masked display hint for the Firecrawl BYOK key (prefix…suffix). Not the secret.';
