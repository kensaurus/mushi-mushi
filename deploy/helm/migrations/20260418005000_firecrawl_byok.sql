-- Migration: 20260418005000_firecrawl_byok
-- Purpose:   Add Firecrawl as a first-class BYOK provider for the new
--            research / fix-augmentation / library-modernizer flows.
--
--            Firecrawl is NOT an LLM — it has no Anthropic-style key shape,
--            no baseUrl flavour, and no quota/billing entanglement with the
--            existing LLM provider list. Rather than overloading
--            `byok.ts::LlmProvider`, we keep it side-by-side: same vault
--            indirection pattern, same audit table, but its own resolver in
--            `_shared/firecrawl.ts`.
--
-- SECURITY:
--   * Stored as a vault://<id> reference, never the raw key.
--   * Per-project domain allow-list to prevent cost-runaway against
--     arbitrary URLs (deny by default if non-empty).
--   * Per-project page cap so a single call cannot blow the budget.

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS byok_firecrawl_key_ref          TEXT,
  ADD COLUMN IF NOT EXISTS byok_firecrawl_key_added_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_firecrawl_key_last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_firecrawl_test_status      TEXT
    CHECK (byok_firecrawl_test_status IS NULL OR byok_firecrawl_test_status IN ('ok','error_auth','error_network','error_quota')),
  ADD COLUMN IF NOT EXISTS byok_firecrawl_tested_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS firecrawl_allowed_domains       TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS firecrawl_max_pages_per_call    INT    NOT NULL DEFAULT 5
    CHECK (firecrawl_max_pages_per_call BETWEEN 1 AND 50);

COMMENT ON COLUMN project_settings.byok_firecrawl_key_ref IS
  'vault://<id> reference for the project''s Firecrawl API key. '
  'Used by _shared/firecrawl.ts for research / fix-augmentation / modernizer crons.';

COMMENT ON COLUMN project_settings.firecrawl_allowed_domains IS
  'hostname allow-list for Firecrawl scrape calls. Empty array = unrestricted; '
  'non-empty = deny by default unless the URL hostname matches one of the entries.';

COMMENT ON COLUMN project_settings.firecrawl_max_pages_per_call IS
  'hard cap on results per firecrawlSearch / pages per crawl call.';

-- Extend byok_audit_log so firecrawl rotations / uses are auditable next to
-- the LLM keys. The original CHECK only allowed ('anthropic','openai').
ALTER TABLE byok_audit_log
  DROP CONSTRAINT IF EXISTS byok_audit_log_provider_check;

ALTER TABLE byok_audit_log
  ADD CONSTRAINT byok_audit_log_provider_check
  CHECK (provider IN ('anthropic','openai','firecrawl'));
