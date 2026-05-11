-- FILE: 20260511120500_revoke_anon_security_definer.sql
--
-- Revokes EXECUTE from the `anon` role on SECURITY DEFINER functions that
-- should never be callable without authentication. These were flagged by
-- the Supabase security advisor (`anon_security_definer_function_executable`).
--
-- SECURITY DEFINER functions run as the function owner, bypassing RLS. An
-- anonymous caller being able to call vault_store_secret, vault_get_secret,
-- fix_dispatch_claim_next, etc. is a direct privilege-escalation vector.
--
-- Functions intentionally left accessible to `anon`:
--   • accept_invitation     — invitation accept flow (pre-auth token exchange)
--   • cleanup_idempotency_keys — called from unauthenticated webhook paths
--   • fn_a2a_push_on_status_change — internal trigger, not user-callable

REVOKE EXECUTE ON FUNCTION public.fix_dispatch_claim_next(integer)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_report_inventory_action(uuid)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_fix_corpus(vector, uuid, integer)            FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_age_snapshot_drift(uuid)                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_age_upsert_edge(uuid, uuid, uuid, uuid, text, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_age_upsert_node(uuid, uuid, text, text)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_apply_retention()                            FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_rls_coverage_snapshot()                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.nl_query_rate_limit_claim(uuid, integer)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.nl_query_rate_limit_claim_with_burst(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nl_query_rate_limit_prune(interval)                FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_prompt_candidate(uuid, text, text)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_expired_report_presence()                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_graph_edges_per_project()                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_sandbox_events_per_project()                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_blast_radius_cache_safe()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_intelligence_benchmarks()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.scoped_rate_limit_claim(uuid, text, integer, interval) FROM anon;
REVOKE EXECUTE ON FUNCTION public.scoped_rate_limit_prune(interval)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.vault_delete_secret(text)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.vault_get_secret(text)                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.vault_lookup(text)                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.vault_store_secret(text, text)                     FROM anon;
