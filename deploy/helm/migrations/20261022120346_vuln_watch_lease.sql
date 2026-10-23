-- ============================================================================
-- vuln_watch_lease
--
-- One vuln-watch run per project at a time (ADR 0038). Two overlapping runs
-- (the 05:25 cron and "Check now", or two clicks) would each read the rows
-- before the other wrote and file the same reports twice. A run claims the
-- project's lease row atomically and deletes it when it ends; a lease left by
-- a run that died expires after its TTL.
--
-- ADDITIVE: one table, two functions executable by service_role only. Apply
-- BEFORE deploying vuln-watch and api-ext.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vuln_watch_leases (
  project_id     uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id         uuid NOT NULL,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  claimed_until  timestamptz NOT NULL
);

COMMENT ON TABLE public.vuln_watch_leases IS
  'ADR 0038: the vuln-watch run that holds a project, until it ends (row deleted) or claimed_until passes. Written only through vuln_watch_claim / vuln_watch_release (service role).';

ALTER TABLE public.vuln_watch_leases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vuln_watch_leases' AND policyname = 'vuln_watch_leases_service_write') THEN
    CREATE POLICY vuln_watch_leases_service_write ON public.vuln_watch_leases FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.vuln_watch_leases FROM anon, authenticated;

-- The run id when this call took the lease; NULL while another run holds it.
-- INSERT … ON CONFLICT DO UPDATE … WHERE locks the row, so of two concurrent
-- calls exactly one gets a run id.
CREATE OR REPLACE FUNCTION public.vuln_watch_claim(p_project_id uuid, p_ttl_seconds integer)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.vuln_watch_leases AS l (project_id, run_id, claimed_at, claimed_until)
  VALUES (p_project_id, gen_random_uuid(), now(), now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 3600))))
  ON CONFLICT (project_id) DO UPDATE
    SET run_id = excluded.run_id, claimed_at = excluded.claimed_at, claimed_until = excluded.claimed_until
    WHERE l.claimed_until < now()
  RETURNING run_id
$$;

-- Ends a run's lease; a stale run id (its lease expired and was taken) does nothing.
CREATE OR REPLACE FUNCTION public.vuln_watch_release(p_project_id uuid, p_run_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.vuln_watch_leases WHERE project_id = p_project_id AND run_id = p_run_id
$$;

REVOKE ALL ON FUNCTION public.vuln_watch_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vuln_watch_release(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vuln_watch_claim(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.vuln_watch_release(uuid, uuid) TO service_role;
