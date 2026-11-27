-- =============================================================================
-- 20261127140000_security_proof_release_kits
--
-- Plan 025 P4 (security proof), P5 (release kit) and P6 (store media).
-- ADR 0074. ADDITIVE and idempotent: apply BEFORE deploying
-- `api` and `api-ext`. Until it is applied the routes answer
-- MIGRATION_PENDING (409), never a 500.
--
--   security_scan_runs        one scanner lane run from the host's own CI
--                             (mushi-security.yml): OSV-Scanner, Gitleaks,
--                             claude-code-security-review, ZAP, Nuclei.
--                             Posted to POST /v1/security/results.
--   security_scan_findings    one normalized finding of a run. Never holds a
--                             secret or a code snippet: the ingest strips
--                             SARIF snippets and region text before insert.
--   reports.source            + 'security_scan' (one open report per
--                             (app, pattern_key), like ux_scorecard)
--   releases.commit_sha       the commit a release ships, so a release's
--                             Security proof is "scans green for that commit"
--   project_settings          security_reports_daily_limit (default 10),
--                             release_kit_clips_enabled (opt-in, default off),
--                             release_kit_clip_max_seconds, release_kit_clip_max_mb
--   release_kits              one kit per release: preset, brand, changelog
--                             lines, the manifest last exported
--   release_kit_assets        before/after screenshots, Playwright clips,
--                             device recordings, the rendered product video
--   storage bucket            release-kits (private, 100 MB per object). The
--                             retention sweep does not touch it: kit assets
--                             are copies, kept with the release.
--
-- RLS: members SELECT through private.is_project_member; writes go through
-- the service client only.
--
-- Verification (after apply):
--   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
--     AND table_name IN ('security_scan_runs','security_scan_findings','release_kits','release_kit_assets');
--   SELECT policyname FROM pg_policies WHERE tablename IN
--     ('security_scan_runs','security_scan_findings','release_kits','release_kit_assets');
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'reports_source_check';
--     -- includes 'security_scan'
--   SELECT id, file_size_limit FROM storage.buckets WHERE id = 'release-kits';
-- =============================================================================

-- ── releases.commit_sha ─────────────────────────────────────────────────────
ALTER TABLE public.releases
  ADD COLUMN IF NOT EXISTS commit_sha text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.releases'::regclass AND conname = 'releases_commit_sha_check'
  ) THEN
    ALTER TABLE public.releases
      ADD CONSTRAINT releases_commit_sha_check
      CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{7,40}$');
  END IF;
END $$;

COMMENT ON COLUMN public.releases.commit_sha IS
  'ADR 0074: the commit this release ships (auto-release sets it from the deploy or release webhook; a person may set it). The release''s Security proof is the scans for this commit. NULL = not pinned: the proof reads "not pinned to a commit", never green.';

-- ── project_settings ────────────────────────────────────────────────────────
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS security_reports_daily_limit integer NOT NULL DEFAULT 10
    CHECK (security_reports_daily_limit BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS release_kit_clips_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_kit_clip_max_seconds integer NOT NULL DEFAULT 30
    CHECK (release_kit_clip_max_seconds BETWEEN 5 AND 60),
  ADD COLUMN IF NOT EXISTS release_kit_clip_max_mb integer NOT NULL DEFAULT 25
    CHECK (release_kit_clip_max_mb BETWEEN 1 AND 100);

COMMENT ON COLUMN public.project_settings.security_reports_daily_limit IS
  'ADR 0074: security_scan reports the ingest may file for this app per UTC day (default 10). 0 stops filing; findings still show on the release''s Security proof.';
COMMENT ON COLUMN public.project_settings.release_kit_clips_enabled IS
  'ADR 0074: opt-in. When true, `mushi-ux clips` may record and upload Playwright clips of the top flows into a release kit. Default off.';
COMMENT ON COLUMN public.project_settings.release_kit_clip_max_seconds IS
  'ADR 0074: longest clip `mushi-ux clips` records per flow (5–60 s, default 30).';
COMMENT ON COLUMN public.project_settings.release_kit_clip_max_mb IS
  'ADR 0074: largest clip or device recording a kit accepts (1–100 MB, default 25).';

-- ── security_scan_runs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_scan_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane          text NOT NULL CHECK (lane IN ('dependencies', 'secrets', 'ai_review', 'dast')),
  tool          text NOT NULL CHECK (tool IN ('osv-scanner', 'gitleaks', 'claude-code-security-review', 'zap-baseline', 'nuclei')),
  tool_version  text CHECK (tool_version IS NULL OR char_length(tool_version) <= 60),
  commit_sha    text CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{7,40}$'),
  ref           text CHECK (ref IS NULL OR char_length(ref) <= 200),
  event         text NOT NULL DEFAULT 'manual'
                  CHECK (event IN ('pull_request', 'push', 'schedule', 'workflow_dispatch', 'manual')),
  pr_number     integer CHECK (pr_number IS NULL OR pr_number > 0),
  target_url    text CHECK (target_url IS NULL OR char_length(target_url) <= 500),
  -- passed: ran, nothing found · findings: ran, found something · error: did not finish · skipped: not configured
  status        text NOT NULL CHECK (status IN ('passed', 'findings', 'error', 'skipped')),
  skip_reason   text CHECK (skip_reason IS NULL OR char_length(skip_reason) <= 300),
  -- { critical, high, medium, low, info, total, deduped, filed }
  counts        jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(counts) = 'object' AND pg_column_size(counts) <= 2048),
  run_url       text CHECK (run_url IS NULL OR char_length(run_url) <= 500),
  started_at    timestamptz,
  finished_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.security_scan_runs IS
  'ADR 0074: one scanner lane run from the host''s own CI (docs/templates/mushi-security.yml), posted to POST /v1/security/results. Mushi never runs these scanners and never hosts their rules.';

CREATE INDEX IF NOT EXISTS security_scan_runs_project_commit
  ON public.security_scan_runs (project_id, commit_sha, finished_at DESC);
CREATE INDEX IF NOT EXISTS security_scan_runs_project_lane
  ON public.security_scan_runs (project_id, lane, finished_at DESC);

-- ── security_scan_findings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_scan_findings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES public.security_scan_runs(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane          text NOT NULL CHECK (lane IN ('dependencies', 'secrets', 'ai_review', 'dast')),
  rule_id       text NOT NULL CHECK (char_length(rule_id) BETWEEN 1 AND 200),
  -- sha256 hex of lane|rule|location|package: one root cause across runs.
  fingerprint   text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  severity      text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  -- { file, line } or { url }; never a snippet.
  location      jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(location) = 'object' AND pg_column_size(location) <= 1024),
  package_name  text CHECK (package_name IS NULL OR char_length(package_name) <= 300),
  advisory_ids  text[] NOT NULL DEFAULT '{}',
  -- Why it was not filed on its own: vuln-watch already has it, or an open
  -- security_scan report already covers the fingerprint.
  deduped_by    text CHECK (deduped_by IS NULL OR deduped_by IN ('vuln_watch', 'open_report', 'daily_limit', 'below_threshold')),
  report_id     uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_scan_findings_once UNIQUE (run_id, fingerprint)
);

COMMENT ON TABLE public.security_scan_findings IS
  'ADR 0074: one normalized finding of a security_scan_runs row. Secrets and code snippets are stripped at ingest (Gitleaks runs with --redact; the server drops SARIF snippet and region text regardless).';

CREATE INDEX IF NOT EXISTS security_scan_findings_project_fp
  ON public.security_scan_findings (project_id, fingerprint);
CREATE INDEX IF NOT EXISTS security_scan_findings_run
  ON public.security_scan_findings (run_id);
CREATE INDEX IF NOT EXISTS security_scan_findings_report
  ON public.security_scan_findings (report_id) WHERE report_id IS NOT NULL;

-- ── release_kits ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.release_kits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    uuid NOT NULL UNIQUE REFERENCES public.releases(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  preset        text NOT NULL DEFAULT 'app_store_preview'
                  CHECK (preset IN ('app_store_preview', 'play_promo', 'social_vertical', 'social_square')),
  -- { name, accent, theme, logoUrl? }: seeded from the project, editable per kit.
  brand         jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(brand) = 'object' AND pg_column_size(brand) <= 4096),
  -- The changelog lines the video tells, from releases.body_md (editable).
  changelog     jsonb NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(changelog) = 'array' AND pg_column_size(changelog) <= 16384),
  manifest      jsonb CHECK (manifest IS NULL OR (jsonb_typeof(manifest) = 'object' AND pg_column_size(manifest) <= 262144)),
  exported_at   timestamptz,
  export_count  integer NOT NULL DEFAULT 0 CHECK (export_count >= 0),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.release_kits IS
  'ADR 0074: the release kit of one release: what a product-video tool (lazycow make_product_video) needs. Mushi never renders video.';

CREATE INDEX IF NOT EXISTS release_kits_project ON public.release_kits (project_id, updated_at DESC);

-- ── release_kit_assets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.release_kit_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id        uuid NOT NULL REFERENCES public.release_kits(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('screenshot_before', 'screenshot_after', 'clip', 'device_recording', 'product_video')),
  source        text NOT NULL CHECK (source IN ('ux_baseline', 'ux_surface', 'playwright', 'upload', 'lazycow')),
  -- <project_id>/<kit_id>/<asset name> in the release-kits bucket.
  storage_path  text NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 10 AND 500),
  mime          text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')),
  bytes         bigint CHECK (bytes IS NULL OR (bytes > 0 AND bytes <= 104857600)),
  sha256        text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  width         integer CHECK (width IS NULL OR width BETWEEN 1 AND 8192),
  height        integer CHECK (height IS NULL OR height BETWEEN 1 AND 8192),
  duration_ms   integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 600000),
  fps           numeric(5,2) CHECK (fps IS NULL OR (fps > 0 AND fps <= 240)),
  codec         text CHECK (codec IS NULL OR char_length(codec) <= 40),
  -- 'measured' = read from the file (PNG IHDR); 'declared' = what the uploader said.
  metadata_from text NOT NULL DEFAULT 'declared' CHECK (metadata_from IN ('measured', 'declared')),
  platform      text CHECK (platform IS NULL OR platform IN ('web', 'ios', 'android')),
  surface_path  text CHECK (surface_path IS NULL OR char_length(surface_path) <= 500),
  viewport      text CHECK (viewport IS NULL OR viewport ~ '^(desktop|mobile|[0-9]{2,4}x[0-9]{2,4})$'),
  label         text CHECK (label IS NULL OR char_length(label) <= 200),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'rejected')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.release_kit_assets IS
  'ADR 0074: one image or video of a release kit, stored in the release-kits bucket. Store uploads (ADR 0074, P6) bind each asset''s storage_path and sha256 into the approved payload.';

CREATE INDEX IF NOT EXISTS release_kit_assets_kit ON public.release_kit_assets (kit_id, kind);

-- ── reports.source: append 'security_scan' ─────────────────────────────────
-- Same append-only pattern as 20261121190000 (ux_scorecard).
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['security_scan'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_source_check not found; refusing to guess the allowed sources';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_source_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_source_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

-- One open report per root cause; the race between two CI posts is settled here.
CREATE UNIQUE INDEX IF NOT EXISTS reports_security_scan_open_pattern_uniq
  ON public.reports (project_id, pattern_key)
  WHERE source = 'security_scan'
    AND pattern_key IS NOT NULL
    AND parent_report_id IS NULL
    AND status IN ('new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened', 'fixing', 'in_progress');

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.security_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_scan_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_kit_assets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['security_scan_runs', 'security_scan_findings', 'release_kits', 'release_kit_assets'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_member_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT private.is_project_member(project_id)))',
        t || '_member_select', t
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service_write') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_write', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ── storage: release-kits ───────────────────────────────────────────────────
-- Private. Read through signed URLs the api mints after a membership check;
-- written only by the service client or a signed upload URL the api mints.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'release-kits', 'release-kits', false, 104857600,
  -- application/json: the kit's manifest.json only (written by the service client).
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/json']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

notify pgrst, 'reload schema';
