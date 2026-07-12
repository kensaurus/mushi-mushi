-- GraphQL/PostgREST anon-exposure hardening for the reporter-community tables.
--
-- `reporter_push_subscriptions` and `feature_request_reporter_votes` are only
-- ever read/written by service-role edge functions (reporter-feature-board.ts,
-- tester-marketplace.ts, the push fan-out). RLS already denies all non-service
-- access (deny-all RESTRICTIVE policy / no permissive anon|auth policy), so no
-- data leaks — but the leftover default `SELECT`/DML grants still surface the
-- tables (and their column names) in the auto-generated GraphQL introspection
-- schema for the `anon` and `authenticated` roles. Revoke them so the tables
-- disappear from the public API surface entirely (security advisor:
-- pg_graphql_anon_table_exposed / pg_graphql_authenticated_table_exposed).
--
-- Idempotent: REVOKE is a no-op if the grant is already absent.

REVOKE ALL ON public.reporter_push_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.feature_request_reporter_votes FROM anon, authenticated;

-- Flush PostgREST's schema + config cache so the revoked grants drop out of the
-- GraphQL/PostgREST introspection surface immediately after deploy.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
