-- Phase 1.1: Create the byok_keys table for unified BYOK key management.
CREATE TABLE IF NOT EXISTS byok_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_slug text NOT NULL CHECK (
    provider_slug IN ('anthropic', 'openai', 'firecrawl', 'browserbase')
  ),
  vault_secret_id uuid NOT NULL,
  key_hint     text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  rotated_at   timestamptz,
  UNIQUE (project_id, provider_slug)
);

ALTER TABLE byok_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS byok_keys_owner_select ON byok_keys;
CREATE POLICY byok_keys_owner_select ON byok_keys
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = byok_keys.project_id
        AND p.owner_id = (SELECT auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_byok_keys_project ON byok_keys(project_id);
