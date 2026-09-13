-- Migration: create sourcemaps table with debug_id support
-- Phase 3 uplift: Debug-ID story (mirrors Sentry's source-map Debug ID workflow).
-- CLI `mushi sourcemaps upload --inject` assigns a UUID per .js file,
-- embeds it as `//# debugId=<uuid>` in the compiled file and in the .map JSON,
-- then uploads the map with this column set. Stack frames can then resolve
-- source positions without fragile release/filename matching.

CREATE TABLE IF NOT EXISTS public.sourcemaps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  release      text NOT NULL,
  filename     text NOT NULL,          -- repo-relative path, forward slashes
  sha256       text NOT NULL,          -- hex sha256 of the map file (idempotency)
  debug_id     text,                   -- UUID injected via --inject; NULL if not used
  size_bytes   bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, release, sha256)
);

ALTER TABLE public.sourcemaps ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) can manage all rows.
CREATE POLICY "service_role full access to sourcemaps"
  ON public.sourcemaps
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Project members can read their project's sourcemaps.
CREATE POLICY "project members can read sourcemaps"
  ON public.sourcemaps
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM public.project_members
      WHERE user_id = auth.uid()
    )
  );

-- Index for release-scoped lookups (most common access pattern).
CREATE INDEX IF NOT EXISTS sourcemaps_project_release_idx
  ON public.sourcemaps (project_id, release);

-- Index for debug_id lookups (used during stack-trace resolution).
CREATE INDEX IF NOT EXISTS sourcemaps_debug_id_idx
  ON public.sourcemaps (debug_id)
  WHERE debug_id IS NOT NULL;
