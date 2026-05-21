-- Round 8 backend hardening: lock down `search_path` on the two newest
-- SECURITY DEFINER functions flagged by the Supabase advisor as
-- `function_search_path_mutable` (whitepaper convention §A4).
--
-- Why this matters: a SECURITY DEFINER function runs with the *owner's*
-- privileges, not the caller's. Without an explicit `search_path` the
-- function inherits whatever search_path the caller had — letting an
-- attacker who can `CREATE FUNCTION` in any schema on the search list
-- shadow `INSERT`, `format`, `ANY`, etc. and escalate. Pinning to
-- `public, pg_catalog` (the two namespaces these functions actually
-- reference) closes the hole without changing behaviour.
--
-- The two affected functions both came from the 2026-05-20 batch:
--   - `public.count_by_column` (20260520900000_create_count_by_column_rpc.sql)
--   - `public.seed_project_settings` (20260520910000_auto_seed_project_settings.sql)

ALTER FUNCTION public.count_by_column(TEXT, UUID[])
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.seed_project_settings()
  SET search_path = public, pg_catalog;
