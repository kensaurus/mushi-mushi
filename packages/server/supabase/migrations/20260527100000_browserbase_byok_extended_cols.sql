-- Extend the browserbase BYOK columns to match the firecrawl pattern:
-- key hint, timestamps, test status so the admin panel has parity.

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS byok_browserbase_key_hint TEXT,
  ADD COLUMN IF NOT EXISTS byok_browserbase_key_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_browserbase_key_last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_browserbase_test_status TEXT
    CHECK (byok_browserbase_test_status IN ('ok', 'error_auth', 'error_network', 'error_quota')),
  ADD COLUMN IF NOT EXISTS byok_browserbase_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_browserbase_session_count INTEGER DEFAULT 0;
