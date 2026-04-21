-- ============================================================
-- C8: Bring Your Own Storage
--
-- Adds project_storage_settings — per-project pointer to where binary
-- artifacts (screenshots, intelligence-report PDFs, fix attachments) live.
-- Provider-agnostic; the application layer fans out to the appropriate
-- adapter (Supabase Storage / S3 / R2 / GCS / MinIO).
--
-- Secrets (S3 access keys, GCS service-account JSON, etc.) are stored as
-- Vault references via Supabase Vault — this table only stores the *names*
-- of the vault entries, never the raw credentials.
-- ============================================================

CREATE TYPE storage_provider AS ENUM (
  'supabase',  -- default; uses the cluster's built-in Supabase Storage
  's3',        -- AWS S3
  'r2',        -- Cloudflare R2 (S3-compatible)
  'gcs',       -- Google Cloud Storage
  'minio'      -- self-hosted MinIO (S3-compatible)
);

CREATE TABLE IF NOT EXISTS project_storage_settings (
  project_id          UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  provider            storage_provider NOT NULL DEFAULT 'supabase',
  bucket              TEXT NOT NULL DEFAULT 'screenshots',
  region              TEXT,                              -- s3/r2 region; gcs location
  endpoint            TEXT,                              -- for r2/minio/custom S3
  path_prefix         TEXT NOT NULL DEFAULT '',          -- optional namespace
  signed_url_ttl_secs INT  NOT NULL DEFAULT 3600 CHECK (signed_url_ttl_secs BETWEEN 60 AND 604800),
  use_signed_urls     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Vault references — populated by the admin Settings panel via Supabase
  -- Vault. The application looks these up at runtime; raw secrets never
  -- live in this table.
  access_key_vault_ref TEXT,
  secret_key_vault_ref TEXT,
  service_account_vault_ref TEXT,
  kms_key_id          TEXT,                              -- optional SSE-KMS
  encryption_required BOOLEAN NOT NULL DEFAULT TRUE,
  health_status       TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'failing')),
  last_health_check_at TIMESTAMPTZ,
  last_health_error   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_storage_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY storage_settings_owner_read
  ON project_storage_settings FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

CREATE POLICY storage_settings_owner_write
  ON project_storage_settings FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

DROP TRIGGER IF EXISTS storage_settings_touch_updated_at ON project_storage_settings;
CREATE TRIGGER storage_settings_touch_updated_at
  BEFORE UPDATE ON project_storage_settings
  FOR EACH ROW EXECUTE FUNCTION mushi_touch_updated_at();

COMMENT ON TABLE project_storage_settings IS
  'per-project storage backend. NULL row = use the cluster default Supabase Storage bucket.';
COMMENT ON COLUMN project_storage_settings.access_key_vault_ref IS
  'Name of the Supabase Vault secret holding the S3-compatible access key. Never store raw keys here.';

-- C8: vault_lookup helper used by the storage adapter.
-- SECURITY DEFINER so service-role Edge Functions can resolve secrets
-- without granting blanket vault.* read access.
CREATE OR REPLACE FUNCTION vault_lookup(secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v TEXT;
BEGIN
  SELECT decrypted_secret INTO v
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION vault_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_lookup(TEXT) TO service_role;
