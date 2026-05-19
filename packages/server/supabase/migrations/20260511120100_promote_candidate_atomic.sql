-- FILE: 20260511120100_promote_candidate_atomic.sql
--
-- Wraps the two-step `promoteCandidate` operation (deactivate old active
-- prompt + activate new candidate) in a single Postgres function so there
-- is no window where both rows are inactive or both are active.
--
-- Before this migration, `_shared/prompt-ab.ts:promoteCandidate()` issued
-- two non-transactional UPDATEs, creating a partial-failure risk: if the
-- Edge Function was killed between the two updates, the `prompt_versions`
-- table would be left with no active row for that (project, stage) — causing
-- every subsequent prompt lookup to fall through to the hardcoded default
-- and silently ending the A/B test.
--
-- Security: SECURITY DEFINER + fixed search_path. Callers need only
-- SELECT / UPDATE on `prompt_versions` via the service role; they don't
-- need raw UPDATE access to multiple rows in one round-trip.

CREATE OR REPLACE FUNCTION public.promote_prompt_candidate(
  p_project_id  uuid,
  p_stage       text,
  p_candidate_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deactivate the current active prompt (all rows except the candidate).
  UPDATE prompt_versions
  SET    is_active = false
  WHERE  project_id = p_project_id
    AND  stage      = p_stage
    AND  is_active  = true
    AND  version   != p_candidate_version;

  -- Promote the candidate atomically in the same transaction.
  UPDATE prompt_versions
  SET    is_active          = true,
         is_candidate       = false,
         traffic_percentage = 100
  WHERE  project_id = p_project_id
    AND  stage      = p_stage
    AND  version    = p_candidate_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promote_prompt_candidate: no row found for project_id=%, stage=%, version=%',
      p_project_id, p_stage, p_candidate_version;
  END IF;
END;
$$;

-- Only service_role should call this.
REVOKE EXECUTE ON FUNCTION public.promote_prompt_candidate(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.promote_prompt_candidate(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.promote_prompt_candidate(uuid, text, text) IS
  'Atomically deactivates the current active prompt and promotes a candidate. Used by prompt-ab.ts:promoteCandidate() to avoid partial-failure gaps in the A/B infrastructure.';
