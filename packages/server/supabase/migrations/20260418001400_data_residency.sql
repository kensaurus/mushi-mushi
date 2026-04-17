-- ============================================================
-- Wave C C7: Data residency
--
-- Adds:
--   * projects.data_residency_region — pin a project to one of
--     'us', 'eu', 'jp', or 'self'. NULL means "use cluster default".
--   * region_routing — public lookup table the gateway can read with the
--     anon key to know which region a project belongs to. Populated by a
--     trigger on `projects` so the gateway can redirect cross-region
--     calls without leaking project metadata.
--   * mushi_current_region() — config-driven helper returning the region
--     this Postgres instance is responsible for. Drives the gateway's
--     307-redirect logic.
-- ============================================================

CREATE TYPE residency_region AS ENUM ('us', 'eu', 'jp', 'self');

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS data_residency_region residency_region;

COMMENT ON COLUMN projects.data_residency_region IS
  'Where this project''s data must live. NULL = use cluster default. Pinned at project creation; changes require an export+restore migration.';

-- 1. Public routing table -----------------------------------------------------
-- The gateway uses the anon key to look up which region a project belongs to
-- *before* authenticating, so we can 307-redirect to the correct cluster
-- without ever loading the project's actual data on the wrong cluster. This
-- table intentionally exposes only the (project_id, region) tuple — no PII.
CREATE TABLE IF NOT EXISTS region_routing (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  region     residency_region NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE region_routing ENABLE ROW LEVEL SECURITY;

-- Read-only by anon: the gateway needs this to redirect.
CREATE POLICY region_routing_public_read
  ON region_routing FOR SELECT
  USING (true);

-- 2. Sync trigger -------------------------------------------------------------
CREATE OR REPLACE FUNCTION mushi_sync_region_routing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data_residency_region IS NOT NULL THEN
    INSERT INTO region_routing (project_id, region)
    VALUES (NEW.id, NEW.data_residency_region)
    ON CONFLICT (project_id) DO UPDATE
      SET region = EXCLUDED.region,
          updated_at = now();
  ELSE
    DELETE FROM region_routing WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_sync_region_routing ON projects;
CREATE TRIGGER projects_sync_region_routing
  AFTER INSERT OR UPDATE OF data_residency_region ON projects
  FOR EACH ROW EXECUTE FUNCTION mushi_sync_region_routing();

-- Backfill from any existing pinned projects.
INSERT INTO region_routing (project_id, region)
SELECT id, data_residency_region FROM projects
WHERE data_residency_region IS NOT NULL
ON CONFLICT (project_id) DO NOTHING;

-- 3. Cluster-local region declaration -----------------------------------------
-- Each regional Supabase project sets `app.settings.cluster_region` in its
-- env (us/eu/jp/self). The Edge Function reads this to determine whether the
-- inbound request belongs here.
CREATE OR REPLACE FUNCTION mushi_current_region()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.settings.cluster_region', true), 'us');
$$;

COMMENT ON FUNCTION mushi_current_region() IS
  'Returns the region this cluster serves. Set via supabase secrets: ALTER DATABASE postgres SET app.settings.cluster_region = ''eu''.';
