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

  This migration revokes EXECUTE from PUBLIC/anon/authenticated and (re-)grants
  it to service_role only — mirroring the lockdown already applied to
  public.get_user_emails_by_ids in 20260621120000. service_role retains EXECUTE
  (confirmed on prod for get_user_emails_by_ids after an identical REVOKE), so
  the edge-function callers (cli-auth / sync / heartbeat routes and the operator
  funnel panel) are unaffected.

DEPENDENCIES:
  - Functions defined in 20260622100000_setup_funnel_events.sql.

USAGE:
  - Applied via `supabase db push` (and applied directly to prod on author date).
  - Idempotent: REVOKE/GRANT are inherently re-runnable.

NOTES:
  - No data is touched. No behavior change for service_role / edge functions.
  - Keep this in lockstep with 20260622100000 so a fresh `db reset` reproduces
    the secured grant state.
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
