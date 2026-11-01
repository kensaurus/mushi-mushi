-- ============================================================================
-- 20261101005900_egress_denials
--
-- Verifiably local (Plan 023 Phase 0, ADR 0034). With MUSHI_LOCAL_ONLY=1 the
-- edge functions refuse every outbound request to a host outside the egress
-- allowlist (_shared/egress.ts). Each refusal is counted here, per host,
-- calling function and UTC day, so the console and `mushi local verify` can
-- show what tried to leave and prove nothing did.
--
--   egress_denials            one row per (host, caller, day) with a count
--   record_egress_denial()    the only writer: service role, called by the
--                             guard through PostgREST
--
-- The table is deployment-wide, not per project: the guard runs below any
-- tenant. Reading it is for organization owners and admins (it names hosts
-- and function names, never request data). The API reads it with the
-- service role (GET /v1/admin/egress/status).
--
-- ADDITIVE: one table, one function. Apply before deploying the api function.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.egress_denials (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host      text        NOT NULL CHECK (char_length(host) BETWEEN 1 AND 255),
  caller    text        NOT NULL DEFAULT 'unknown' CHECK (char_length(caller) BETWEEN 1 AND 100),
  day       date        NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  count     bigint      NOT NULL DEFAULT 1 CHECK (count >= 1),
  first_at  timestamptz NOT NULL DEFAULT now(),
  last_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT egress_denials_host_caller_day_key UNIQUE (host, caller, day)
);

COMMENT ON TABLE public.egress_denials IS
  'Outbound requests refused by the local-only egress guard (MUSHI_LOCAL_ONLY=1), counted per host, calling function and UTC day. Plan 023, ADR 0034.';

-- The status route lists the newest days first.
CREATE INDEX IF NOT EXISTS egress_denials_day_idx ON public.egress_denials (day DESC, last_at DESC);

ALTER TABLE public.egress_denials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.egress_denials FROM anon, authenticated;
GRANT SELECT ON public.egress_denials TO authenticated;
GRANT ALL ON public.egress_denials TO service_role;

DROP POLICY IF EXISTS egress_denials_owner_admin_select ON public.egress_denials;
CREATE POLICY egress_denials_owner_admin_select ON public.egress_denials
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS egress_denials_service_write ON public.egress_denials;
CREATE POLICY egress_denials_service_write ON public.egress_denials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- One call per refused request. Upserts the day's row and bumps the count.
-- SECURITY DEFINER so the insert never depends on the caller's grants; only
-- the service role may execute it.
CREATE OR REPLACE FUNCTION public.record_egress_denial(p_host text, p_caller text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_host   text := left(lower(btrim(coalesce(p_host, ''))), 255);
  v_caller text := left(btrim(coalesce(p_caller, '')), 100);
BEGIN
  IF v_host = '' THEN
    RETURN;
  END IF;
  IF v_caller = '' THEN
    v_caller := 'unknown';
  END IF;
  INSERT INTO public.egress_denials AS d (host, caller, day, count, first_at, last_at)
  VALUES (v_host, v_caller, (now() AT TIME ZONE 'utc')::date, 1, now(), now())
  ON CONFLICT (host, caller, day)
  DO UPDATE SET count = d.count + 1, last_at = now();
END;
$$;

COMMENT ON FUNCTION public.record_egress_denial(text, text) IS
  'Count one refused outbound request (local-only egress guard). Service role only. Plan 023, ADR 0034.';

REVOKE ALL ON FUNCTION public.record_egress_denial(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_egress_denial(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_egress_denial(text, text) TO service_role;
