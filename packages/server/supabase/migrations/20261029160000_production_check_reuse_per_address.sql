-- =============================================================================
-- Production Check: reuse a same-day report per address, not per origin.
--
-- production_check_begin() handed back any report from the last 24 hours for
-- the same origin. Apps hosted under a path share an origin
-- (https://kensaur.us/glot-it, https://kensaur.us/yen-yen), so the second app
-- checked that day got the first app's report back (found 2026-10-29 by a
-- first-time-user walk-through: checking kensaur.us/the-wanting-mind would
-- have answered every other kensaur.us app for a day). The report is now
-- reused only for the same address, a trailing slash ignored. The per-IP and
-- daily caps in api/routes/production-check.ts still bound the spend.
--
-- Additive: the same signature, OR REPLACE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.production_check_begin(
  p_origin  text,
  p_url     text,
  p_ip_hash text,
  p_email   text,
  p_src     text
) RETURNS TABLE (check_id uuid, cached boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_key text := rtrim(p_url, '/');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('production_check:' || v_key, 0));

  SELECT pc.id INTO v_id
    FROM public.production_checks pc
   WHERE pc.origin = p_origin
     AND rtrim(pc.url, '/') = v_key
     AND pc.created_at > now() - interval '24 hours'
     AND (pc.status = 'done' OR (pc.status = 'running' AND pc.created_at > now() - interval '2 minutes'))
   ORDER BY pc.created_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  INSERT INTO public.production_checks (origin, url, ip_hash, email, src)
  VALUES (p_origin, p_url, p_ip_hash, p_email, p_src)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.production_check_begin(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_check_begin(text, text, text, text, text) TO service_role;
