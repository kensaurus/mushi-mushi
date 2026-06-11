-- ============================================================
-- Mushi Mushi — Revoke anon SELECT on new TDD/BYOK/content tables
-- ============================================================
-- The 2026-06-02 TDD engine + BYOK multi-key + content-quality
-- migrations created (or touched) tables that inherited the
-- project's default `anon` SELECT grant, exposing their structure
-- in the GraphQL anon schema even though RLS returns zero rows to
-- anon. This matches the hardening done in
-- 20260527040000_revoke_anon_select_authenticated_only_tables.sql.
--
-- Each of these tables is gated by RLS to service_role and/or the
-- authenticated project owner/member, so anon never reads a row.
-- Revoking anon SELECT removes the GraphQL exposure entirely while
-- preserving every authenticated/service flow.
--
-- `authenticated` SELECT is intentionally left in place:
--   - byok_keys relies on it for its `byok_keys_member_select`
--     policy (owners read their own key metadata via PostgREST),
--   - this mirrors the project-wide posture where authenticated
--     access is gated by RLS rather than table grants.
--
-- qa_stories already had anon SELECT revoked on 2026-05-27.
-- ============================================================

DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'public.byok_keys',
    'public.content_quality_issues',
    'public.story_map_runs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    BEGIN
      EXECUTE format('REVOKE SELECT ON %s FROM anon', tbl);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Skipping missing table %', tbl;
    END;
  END LOOP;
END $$;

-- Flush PostgREST's schema/config caches so the revoked privileges take effect
-- on the auto-generated REST surface immediately, without waiting for a pod
-- restart or periodic refresh (repo convention for privilege/schema changes).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
