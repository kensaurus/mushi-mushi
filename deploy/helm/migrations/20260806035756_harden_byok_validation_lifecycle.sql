-- New credentials are quarantined until a provider probe proves that they
-- authenticate. This prevents a typo, revoked key, or unsafe compatible-API
-- URL from entering the runtime failover pool.

ALTER TABLE public.byok_keys
  ADD COLUMN IF NOT EXISTS base_url text;

ALTER TABLE public.byok_keys
  DROP CONSTRAINT IF EXISTS byok_keys_status_check;

ALTER TABLE public.byok_keys
  ADD CONSTRAINT byok_keys_status_check
  CHECK (
    status IN (
      'pending_validation',
      'active',
      'disabled',
      'quota_exhausted',
      'auth_failed'
    )
  );

ALTER TABLE public.byok_keys
  ALTER COLUMN status SET DEFAULT 'pending_validation';

-- Existing rows that have never passed an explicit probe must not remain
-- selectable merely because the old default was "active".
UPDATE public.byok_keys
SET status = 'pending_validation'
WHERE status = 'active'
  AND test_status IS DISTINCT FROM 'ok';

ALTER TABLE public.byok_keys
  DROP CONSTRAINT IF EXISTS byok_keys_active_requires_validation_check;

ALTER TABLE public.byok_keys
  ADD CONSTRAINT byok_keys_active_requires_validation_check
  CHECK (status <> 'active' OR test_status = 'ok');

ALTER TABLE public.byok_keys
  DROP CONSTRAINT IF EXISTS byok_keys_base_url_length_check;

ALTER TABLE public.byok_keys
  ADD CONSTRAINT byok_keys_base_url_length_check
  CHECK (
    base_url IS NULL
    OR (
      provider_slug = 'openai'
      AND char_length(base_url) BETWEEN 1 AND 2048
    )
  );

COMMENT ON COLUMN public.byok_keys.base_url IS
  'Validated HTTPS endpoint for an OpenAI-compatible provider. NULL uses the official OpenAI API.';

COMMENT ON COLUMN public.byok_keys.status IS
  'Credential lifecycle. pending_validation is quarantined and cannot be resolved for runtime use.';

ALTER TABLE public.byok_audit_log
  DROP CONSTRAINT IF EXISTS byok_audit_log_action_check;

ALTER TABLE public.byok_audit_log
  ADD CONSTRAINT byok_audit_log_action_check
  CHECK (action IN ('added', 'rotated', 'removed', 'used', 'tested'));

ALTER TABLE public.byok_audit_log
  DROP CONSTRAINT IF EXISTS byok_audit_log_provider_check;

ALTER TABLE public.byok_audit_log
  ADD CONSTRAINT byok_audit_log_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'firecrawl', 'browserbase', 'cursor'));

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
