-- Migration: 20260612010000_gate_types_v2_schema_snapshots
--
-- 1. Extends gate_runs.gate CHECK constraint to include new gates introduced in
--    the full-stack upgrade: spec_drift, orphan_endpoint, unknown_call, schema_drift.
--
-- 2. Adds backend_schema_snapshots table used by the backend-drift-scanner cron
--    to detect DB schema changes across linked host-app Supabase projects.
--
-- 3. Adds openapi_spec_url / openapi_spec_path to project_settings so Gate 6
--    (oasdiff spec_drift) can locate the OpenAPI spec for each project.
--
-- All changes are backward-compatible: existing rows are not touched, existing
-- gate names still pass the updated constraints.

-- ── 1. Extend gate CHECK constraints ────────────────────────────────────────

-- gate_runs.gate
ALTER TABLE public.gate_runs
  DROP CONSTRAINT IF EXISTS gate_runs_gate_check;

ALTER TABLE public.gate_runs
  ADD CONSTRAINT gate_runs_gate_check
  CHECK (gate IN (
    'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim',
    'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift'
  ));

-- gate_findings.gate (derived from gate_run; no FK but let's keep it consistent)
-- gate_findings has no direct gate column per the v2 schema — findings are linked
-- via gate_run_id. The rule_id column carries the per-finding type. No constraint
-- to modify here.

-- ── 2. backend_schema_snapshots ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.backend_schema_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  schema_json  jsonb NOT NULL,
  schema_hash  text NOT NULL,
  diff_summary jsonb,                    -- JSON diff vs previous snapshot (null on first)
  CONSTRAINT backend_schema_snapshots_hash_len CHECK (char_length(schema_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_backend_schema_snapshots_project_captured
  ON public.backend_schema_snapshots (project_id, captured_at DESC);

ALTER TABLE public.backend_schema_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_schema_snapshots_select"
  ON public.backend_schema_snapshots FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = auth.uid()
    )
  );

CREATE POLICY "backend_schema_snapshots_service_write"
  ON public.backend_schema_snapshots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.backend_schema_snapshots IS
  'Daily point-in-time snapshots of a linked host-app Supabase schema (tables, columns, '
  'RLS, functions) captured via the read-only hosted Supabase MCP. Used by '
  'backend-drift-scanner to detect unexpected schema changes and write gate_findings '
  'of type schema_drift.';

-- ── 3. OpenAPI spec + span ingest settings on project_settings ──────────────

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS openapi_spec_url  text,
  ADD COLUMN IF NOT EXISTS openapi_spec_path text;

COMMENT ON COLUMN public.project_settings.openapi_spec_url IS
  'URL to the project''s OpenAPI spec (JSON or YAML). Used by Gate 6 (spec_drift) '
  'to fetch the current spec and diff it against the previous version via oasdiff. '
  'Leave blank to rely on the discovered-API path (Gate 3) instead.';

COMMENT ON COLUMN public.project_settings.openapi_spec_path IS
  'Relative path within the project''s github_repo_url to the OpenAPI spec file '
  '(e.g. "openapi.yaml" or "docs/api/openapi.json"). Used by mcp-ci Gate 6 when '
  'openapi_spec_url is not set (file read from the checked-out repo).';

-- ── 4. Notify PostgREST ─────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
