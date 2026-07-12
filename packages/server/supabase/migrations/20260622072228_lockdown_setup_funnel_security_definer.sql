/*
FILE: 20260622140000_lockdown_setup_funnel_security_definer.sql
PURPOSE: Close an anon-callable RLS bypass on the two setup-funnel SECURITY
  DEFINER functions created in 20260622100000_setup_funnel_events.sql.

OVERVIEW:
  20260622100000 created `setup_funnel_events` with a RESTRICTIVE deny-all RLS
  policy ("service role only"), plus two SECURITY DEFINER helpers:
    - public.upsert_setup_funnel_event(uuid,uuid,text,text,text,jsonb)  (write)
    - public.get_setup_funnel_counts_7d()                                (read)
  Neither had its default `EXECUTE TO PUBLIC` grant revoked. Because they are
  SECURITY DEFINER and live in the PostgREST-exposed `public` schema, anyone
  holding the project's public anon key could call them and bypass the deny-all
  RLS — writing arbitrary funnel rows (integrity/abuse) or reading aggregate
  onboarding counts (operator-only data). Verified live on prod
  (dxptnwrhwsqckaftyymj): anon + authenticated both had EXECUTE on both.

  This migration revokes EXECUTE from PUBLIC/anon/authenticated, following the
  same intent as the lockdown applied to public.get_user_emails_by_ids in
  20260621120000. Note that 20260621120000 only REVOKEs (no explicit GRANT) and
  relies on service_role keeping EXECUTE via Supabase's default privileges
  (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO service_role`,
  which is independent of the PUBLIC grant being revoked). This migration is
  deliberately more explicit: it ALSO issues `GRANT EXECUTE ... TO service_role`
  so the edge-function callers (cli-auth / sync / heartbeat routes and the
  operator funnel panel) never depend on implicit default-privilege behaviour.
  Verified on prod: after the REVOKE/GRANT, EXECUTE is held only by postgres
  (owner) + service_role; anon/authenticated have none.

DEPENDENCIES:
  - Functions defined in 20260622100000_setup_funnel_events.sql.

USAGE:
  - Applied via `supabase db push` (and applied directly to prod on author date).
  - Idempotent: REVOKE/GRANT are inherently re-runnable.

NOTES:
  - No data is touched. No behavior change for service_role / edge functions.
  - Keep this in lockstep with 20260622100000 so a fresh `db reset` reproduces
    the secured grant state.
  - The trailing `NOTIFY pgrst` calls flush PostgREST's schema + privilege
    caches. Without them, PostgREST can keep serving the pre-REVOKE privilege
    cache (anon/authenticated still able to call these /rpc endpoints) for up to
    several minutes after deploy — undermining the lockdown. Mirrors the pattern
    in 20260527090000_copilot_followup_security_signatures_notify.sql. The same
    NOTIFY was fired directly on prod after this migration's REVOKE/GRANT.
*/

-- Write helper: only the edge functions (service role) may upsert funnel events.
REVOKE EXECUTE ON FUNCTION public.upsert_setup_funnel_event(uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_setup_funnel_event(uuid, uuid, text, text, text, jsonb)
  TO service_role;

-- Read helper: only the operator funnel panel (service role) may read counts.
REVOKE EXECUTE ON FUNCTION public.get_setup_funnel_counts_7d()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_setup_funnel_counts_7d()
  TO service_role;

-- Flush PostgREST's schema + privilege caches so the REVOKEs above take effect
-- immediately on the exposed /rpc surface (otherwise the old grants can be
-- served from cache for several minutes after deploy).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
