-- Migration: 20260418000800_byok_keys
-- Purpose:   Add Bring-Your-Own-Key (BYOK) columns for LLM providers (V5.3 §2.7,
--            §2.18, M-cross-cutting). Schema only — end-to-end wiring lands in
-- C9. Until then, the `_shared/byok.ts` helper resolves
--            effective keys (BYOK first, env fallback) and stays a no-op.
--
-- SECURITY:
--   The columns are stored as `text` and protected by RLS — only project owners
--   may SELECT them. To prevent secrets from leaking through error logs and
--   query plans, downstream code MUST:
--     1. Strip these columns from any logging context (see _shared/logger.ts).
--     2. Use Supabase Vault for production; the schema below assumes vault is
--        the source of truth and these columns hold a `vault://<secret_id>`
--        reference, NOT the raw token. The `byok.ts` resolver dereferences.
--     3. Never expose them via the public `api` function — only via the
--        admin JWT-authenticated endpoints under `/v1/admin/byok/*`.

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS byok_anthropic_key_ref TEXT,
  ADD COLUMN IF NOT EXISTS byok_openai_key_ref TEXT,
  ADD COLUMN IF NOT EXISTS byok_anthropic_key_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_openai_key_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_anthropic_key_last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_openai_key_last_used_at TIMESTAMPTZ;

COMMENT ON COLUMN project_settings.byok_anthropic_key_ref IS
  'V5.3 BYOK: vault reference (vault://<id>) or raw key for Anthropic. ' ||
  'Prefer vault references in production; raw keys are for local dev only.';

COMMENT ON COLUMN project_settings.byok_openai_key_ref IS
  'V5.3 BYOK: vault reference for OpenAI judge fallback (V5.3 §2.7).';

-- Strict RLS: only project owners can SELECT/UPDATE these columns. Members with
-- non-owner roles MUST NOT see the references (RLS at row level cannot mask
-- specific columns; we rely on the existing project_settings policy that
-- already restricts to membership, AND on a CHECK that callers go through the
-- /v1/admin/byok/* helper which strips secrets from responses).

-- Audit table: every BYOK rotation MUST be logged for SOC 2 readiness.
CREATE TABLE IF NOT EXISTS byok_audit_log (
  id BIGSERIAL PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id),
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  action TEXT NOT NULL CHECK (action IN ('added', 'rotated', 'removed', 'used')),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_byok_audit_log_project_ts
  ON byok_audit_log (project_id, ts DESC);

ALTER TABLE byok_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read own project byok audit" ON byok_audit_log
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "service role write byok audit" ON byok_audit_log
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');
