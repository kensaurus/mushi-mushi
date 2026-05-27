-- ============================================================
-- Mushi Mushi v2 — Revoke EXECUTE on internal SECURITY DEFINER RPCs
-- ============================================================
-- Every caller of these SECURITY DEFINER functions lives in
-- packages/server/supabase/functions/ (edge functions) and uses a
-- service_role Supabase client to invoke them. service_role has
-- BYPASSRLS=true and is exempt from EXECUTE GRANTs, so revoking
-- EXECUTE from PUBLIC, anon, and authenticated is a pure security
-- hardening: it removes them from the anon/authenticated GraphQL
-- + PostgREST surface without affecting any working code path.
--
-- Verified callsite for every entry below:
--   packages/server/supabase/functions/**/*.ts (zero hits in apps/)
-- ============================================================

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.accept_invitation(text)',
    'public.award_tester_points(uuid, integer, text, uuid, uuid, text)',
    'public.check_marketplace_budget(uuid, numeric)',
    'public.check_payout_budget(uuid, numeric)',
    'public.count_by_column(text, uuid[])',
    'public.delete_tester_data(uuid)',
    'public.export_end_user_data(uuid)',
    'public.export_tester_data(uuid)',
    'public.fix_dispatch_claim_next(integer)',
    'public.get_org_feature_flags(uuid)',
    'public.get_report_inventory_action(uuid)',
    'public.get_tester_apps_enriched(uuid)',
    'public.match_lessons(extensions.vector, double precision, integer, uuid)',
    'public.mushi_age_snapshot_drift(uuid)',
    'public.mushi_age_upsert_edge(uuid, uuid, uuid, uuid, text, double precision)',
    'public.mushi_age_upsert_node(uuid, uuid, text, text)',
    'public.nl_query_rate_limit_claim(uuid, integer)',
    'public.nl_query_rate_limit_claim_with_burst(uuid, integer, integer)',
    'public.promote_prompt_candidate(uuid, text, text)',
    'public.scoped_rate_limit_claim(uuid, text, integer, interval)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Skipping missing function %', fn;
    END;
  END LOOP;
END $$;
