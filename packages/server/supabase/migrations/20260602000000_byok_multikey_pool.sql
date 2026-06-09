-- Phase 0: Multi-key BYOK pool
-- Drops the UNIQUE constraint that limited each project to one key per
-- provider, adds priority ordering, per-key status + cooldown for
-- quota-aware failover, and a human-readable label.
-- Also adds 'cursor' as a supported provider slug.

-- 1. Drop the old unique constraint so we can have multiple keys per provider.
ALTER TABLE byok_keys DROP CONSTRAINT IF EXISTS byok_keys_project_id_provider_slug_key;

-- 2. Widen the provider_slug CHECK to include 'cursor'.
ALTER TABLE byok_keys DROP CONSTRAINT IF EXISTS byok_keys_provider_slug_check;
ALTER TABLE byok_keys ADD CONSTRAINT byok_keys_provider_slug_check CHECK (
  provider_slug IN ('anthropic', 'openai', 'firecrawl', 'browserbase', 'cursor')
);

-- 3. Add new columns for multi-key management.
ALTER TABLE byok_keys
  ADD COLUMN IF NOT EXISTS label           text,
  ADD COLUMN IF NOT EXISTS priority        int  NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'quota_exhausted', 'auth_failed')),
  ADD COLUMN IF NOT EXISTS cooldown_until  timestamptz,
  ADD COLUMN IF NOT EXISTS last_error      text,
  ADD COLUMN IF NOT EXISTS last_tested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS test_status     text
    CHECK (test_status IN ('ok', 'error_auth', 'error_network', 'error_quota') OR test_status IS NULL);

-- 4. Partial index: ordered active keys per project + provider.
CREATE INDEX IF NOT EXISTS idx_byok_keys_active_ordered
  ON byok_keys (project_id, provider_slug, priority ASC)
  WHERE status = 'active';

-- 5. Service-role insert/update policy (edge functions use service role).
--    Scope explicitly TO service_role. Without the TO clause this policy
--    defaults to TO public, which would grant ALL operations on every
--    project's keys to any anon/authenticated caller — a cross-tenant
--    read/delete hole. service_role bypasses RLS anyway, so this policy is
--    effectively a no-op guard that documents the intended writer while
--    keeping the table closed to anon/authenticated writes.
DROP POLICY IF EXISTS byok_keys_service_write ON byok_keys;
CREATE POLICY byok_keys_service_write ON byok_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow the authenticated project owner to also select their keys.
DROP POLICY IF EXISTS byok_keys_member_select ON byok_keys;
CREATE POLICY byok_keys_member_select ON byok_keys
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = byok_keys.project_id
        AND pm.user_id = (SELECT auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = byok_keys.project_id
        AND p.owner_id = (SELECT auth.uid())
    )
  );

-- Flush PostgREST's schema/config caches so the new table/columns/policies are
-- visible to API callers within seconds, not minutes (repo convention for
-- structural migrations).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
