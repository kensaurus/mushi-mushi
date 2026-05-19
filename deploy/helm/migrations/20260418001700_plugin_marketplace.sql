-- ============================================================
-- D1: Plugin marketplace + webhook dispatcher
--
-- Extends the existing `project_plugins` table with the columns needed for
-- third-party HTTPS webhook plugins (URL, Vault-backed signing secret,
-- subscribed events). Adds two new tables:
--   * `plugin_registry` — catalog of plugins available in the marketplace.
--   * `plugin_dispatch_log` — per-delivery audit + retry state.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. project_plugins: webhook columns
-- ----------------------------------------------------------------
ALTER TABLE project_plugins
  ADD COLUMN IF NOT EXISTS plugin_slug TEXT,
  ADD COLUMN IF NOT EXISTS webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_vault_ref TEXT,
  ADD COLUMN IF NOT EXISTS subscribed_events TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS scoped_api_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_delivery_status TEXT
    CHECK (last_delivery_status IS NULL OR last_delivery_status IN ('ok', 'error', 'timeout', 'skipped'));

COMMENT ON COLUMN project_plugins.webhook_url IS
  'HTTPS endpoint that receives signed event webhooks. NULL = built-in plugin.';
COMMENT ON COLUMN project_plugins.webhook_secret_vault_ref IS
  'Supabase Vault entry name holding the HMAC signing secret. NEVER raw.';
COMMENT ON COLUMN project_plugins.subscribed_events IS
  'array of event names (e.g. {report.created, fix.applied}). Empty = all.';

CREATE INDEX IF NOT EXISTS idx_project_plugins_slug ON project_plugins (plugin_slug);

-- ----------------------------------------------------------------
-- 2. plugin_registry: marketplace catalog
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plugin_registry (
  slug                 TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  short_description    TEXT NOT NULL,
  long_description     TEXT,
  publisher            TEXT NOT NULL,
  homepage_url         TEXT,
  source_url           TEXT,
  manifest             JSONB NOT NULL,             -- declared events, scopes, schema
  required_scopes      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  install_count        BIGINT NOT NULL DEFAULT 0,
  category             TEXT NOT NULL DEFAULT 'integration',
  is_official          BOOLEAN NOT NULL DEFAULT FALSE,
  is_listed            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plugin_registry ENABLE ROW LEVEL SECURITY;

-- Marketplace catalog is intentionally readable by every authenticated user
-- and even by `anon` so the public landing page can list plugins.
CREATE POLICY plugin_registry_public_read
  ON plugin_registry FOR SELECT
  USING (is_listed = TRUE);

-- Only service_role may write to the registry. Operators publish via PR
-- against the seed file below.
CREATE POLICY plugin_registry_service_write
  ON plugin_registry FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP TRIGGER IF EXISTS plugin_registry_touch_updated_at ON plugin_registry;
CREATE TRIGGER plugin_registry_touch_updated_at
  BEFORE UPDATE ON plugin_registry
  FOR EACH ROW EXECUTE FUNCTION mushi_touch_updated_at();

-- ----------------------------------------------------------------
-- 3. plugin_dispatch_log: per-delivery audit + retry state
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plugin_dispatch_log (
  id                BIGSERIAL PRIMARY KEY,
  delivery_id       UUID NOT NULL UNIQUE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plugin_slug       TEXT NOT NULL,
  event             TEXT NOT NULL,
  attempt           INT NOT NULL DEFAULT 1,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error', 'timeout', 'skipped')),
  http_status       INT,
  response_excerpt  TEXT,                                       -- first 512 chars
  duration_ms       INT,
  next_retry_at     TIMESTAMPTZ,
  payload_digest    TEXT NOT NULL,                              -- sha256(rawBody) for forensic tie-back
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plugin_dispatch_project_event
  ON plugin_dispatch_log (project_id, event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_dispatch_pending
  ON plugin_dispatch_log (status, next_retry_at)
  WHERE status = 'pending';

ALTER TABLE plugin_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY plugin_dispatch_owner_read
  ON plugin_dispatch_log FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

CREATE POLICY plugin_dispatch_service_write
  ON plugin_dispatch_log FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP TRIGGER IF EXISTS plugin_dispatch_touch_updated_at ON plugin_dispatch_log;
CREATE TRIGGER plugin_dispatch_touch_updated_at
  BEFORE UPDATE ON plugin_dispatch_log
  FOR EACH ROW EXECUTE FUNCTION mushi_touch_updated_at();

-- ----------------------------------------------------------------
-- 4. Seed the three reference plugins so the marketplace is non-empty on
--    first deploy. Operators can later add more rows via PR.
-- ----------------------------------------------------------------
INSERT INTO plugin_registry (slug, name, short_description, publisher, source_url, manifest, required_scopes, category, is_official)
VALUES
  ('pagerduty', 'PagerDuty Escalation', 'Page on-call when a critical-severity bug is reported.', 'mushi-mushi',
   'https://github.com/kensaurus/mushi-mushi/tree/main/packages/plugin-pagerduty',
   jsonb_build_object(
     'subscribes', ARRAY['report.classified', 'sla.breached'],
     'config', jsonb_build_object('routing_key', 'string', 'severity_threshold', 'string')
   ),
   ARRAY['reports.read', 'reports.comment'], 'incident', TRUE),
  ('linear', 'Linear Sync', 'Create and bidirectionally sync Linear issues from Mushi reports.', 'mushi-mushi',
   'https://github.com/kensaurus/mushi-mushi/tree/main/packages/plugin-linear',
   jsonb_build_object(
     'subscribes', ARRAY['report.created', 'report.classified', 'report.status_changed'],
     'config', jsonb_build_object('linear_api_key', 'string', 'team_id', 'string')
   ),
   ARRAY['reports.read', 'reports.comment', 'reports.transition'], 'project-management', TRUE),
  ('zapier', 'Zapier Bridge', 'Fan out any Mushi event to a Zapier-style incoming webhook.', 'mushi-mushi',
   'https://github.com/kensaurus/mushi-mushi/tree/main/packages/plugin-zapier',
   jsonb_build_object(
     'subscribes', ARRAY['*'],
     'config', jsonb_build_object('zapier_hook_url', 'string')
   ),
   ARRAY['reports.read'], 'integration', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  short_description = EXCLUDED.short_description,
  publisher = EXCLUDED.publisher,
  source_url = EXCLUDED.source_url,
  manifest = EXCLUDED.manifest,
  required_scopes = EXCLUDED.required_scopes,
  category = EXCLUDED.category,
  is_official = EXCLUDED.is_official,
  updated_at = now();
