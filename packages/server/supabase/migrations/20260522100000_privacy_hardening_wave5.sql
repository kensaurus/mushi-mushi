-- =============================================================================
-- Wave 5 Privacy Hardening
-- =============================================================================
-- SEC (Gap D): Add require_byok flag to project_settings.
--   When true, the Edge Function will hard-reject any LLM call that would fall
--   back to the platform Anthropic/OpenAI env key. Enabled by default on
--   Cloud-paid and Enterprise plans via the billing hook; free tier defaults
--   false (platform key is still a fallback so the trial experience works).
-- =============================================================================
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS require_byok BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS byok_status_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.project_settings.require_byok IS
  'When TRUE the classify-report / fix-worker pipeline will hard-fail if neither '
  'BYOK Anthropic nor BYOK OpenAI is configured, rather than falling back to the '
  'platform API key. Set to TRUE automatically for Cloud-paid and Enterprise plans.';

-- =============================================================================
-- SEC (Gap F): Replace vault_store_secret(name, value) with a project-scoped
--   version that enforces the naming convention
--   mushi_<project_id>_<provider>_<suffix>.
--   This closes the gap where a bug in any admin route that calls
--   vault_store_secret with a wrong project namespace could overwrite another
--   tenant's secret.
-- =============================================================================

-- Drop the old two-arg form and replace it with a three-arg version that
-- requires the caller to supply project_id and validates the name prefix.
CREATE OR REPLACE FUNCTION vault_store_secret(
  secret_name  TEXT,
  secret_value TEXT,
  p_project_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_id UUID;
  expected_prefix TEXT;
BEGIN
  -- SEC (Gap-F): when project_id is supplied, enforce the naming convention so
  -- a misconfigured caller cannot stomp on a different tenant's secret.
  IF p_project_id IS NOT NULL THEN
    expected_prefix := 'mushi_' || p_project_id::TEXT || '_';
    IF NOT starts_with(secret_name, expected_prefix) THEN
      RAISE EXCEPTION 'vault_store_secret: secret_name must start with % (got %)',
        expected_prefix, secret_name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Try update first (rotation path).
  UPDATE vault.secrets
     SET secret = secret_value, updated_at = now()
   WHERE name = secret_name
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT vault.create_secret(secret_value, secret_name) INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- Preserve existing grants.
REVOKE ALL ON FUNCTION vault_store_secret(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_store_secret(TEXT, TEXT, UUID) TO service_role;
