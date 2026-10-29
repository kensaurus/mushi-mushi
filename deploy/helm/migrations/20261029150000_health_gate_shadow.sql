-- =============================================================================
-- Health gate shadow counts (plan-simplicity-2026-10 Phase 1 unit B, ADR 0054).
--
-- With mushi_runtime_config.health_gate_mode = 'observe', each dispatcher
-- (fix-worker, review-followup, merge-queue, spend-down-worker) records here
-- that a Health check WOULD have paused its work for an app, and then runs as
-- before. With 'enforce' the same row counts the work it withheld. One row per
-- (app, automation, check, UTC day), so a day of shadow data can be read
-- before enforce is turned on per check.
--
-- Additive only. Writers ignore a missing table or function. Service role
-- only; rows hold ids and counts, no report or key content.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.health_gate_shadow (
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  automation  text NOT NULL,
  check_id    text NOT NULL,
  day         date NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('observe', 'enforce')),
  count       integer NOT NULL DEFAULT 0,
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, automation, check_id, day, mode)
);

ALTER TABLE public.health_gate_shadow ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS health_gate_shadow_service_all ON public.health_gate_shadow;
CREATE POLICY health_gate_shadow_service_all ON public.health_gate_shadow
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.health_gate_shadow FROM anon, authenticated;

COMMENT ON TABLE public.health_gate_shadow IS
  'Per day: how often a Health check would pause (observe) or paused (enforce) an automation for an app. ADR 0054. Service role only.';

CREATE OR REPLACE FUNCTION public.health_gate_record(
  p_project_id uuid,
  p_automation text,
  p_check_ids text[],
  p_mode text
) RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.health_gate_shadow AS s (project_id, automation, check_id, day, mode, count)
  SELECT p_project_id, left(p_automation, 64), left(c, 64), (now() AT TIME ZONE 'utc')::date, p_mode, 1
  FROM unnest(p_check_ids[1:20]) AS c
  WHERE p_mode IN ('observe', 'enforce')
  ON CONFLICT (project_id, automation, check_id, day, mode)
  DO UPDATE SET count = s.count + 1, last_at = now();
$$;

REVOKE ALL ON FUNCTION public.health_gate_record(uuid, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_gate_record(uuid, text, text[], text) TO service_role;
