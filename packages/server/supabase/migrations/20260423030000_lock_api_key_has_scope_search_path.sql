-- Wave S follow-up: lock search_path on `api_key_has_scope`.
--
-- This helper is called from the RLS policies on every scope-gated admin
-- table — thousands of times per query on a busy project. The advisor
-- (0011_function_search_path_mutable) flagged it because the original
-- definition (20260421003000_api_key_scopes.sql) did not pin search_path,
-- meaning a malicious role with CREATE privilege on any schema could
-- shadow `any(...)` or the implicit text = any() cast.
--
-- Pinning to `pg_catalog, pg_temp` is tightest — the function only needs
-- the built-in array operators. `IMMUTABLE` is preserved so Postgres can
-- still inline the call inside RLS plans.
create or replace function public.api_key_has_scope(p_scopes text[], p_required text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_required = 'mcp:read'
      then ('mcp:read' = any(p_scopes) or 'mcp:write' = any(p_scopes))
    else p_required = any(p_scopes)
  end;
$$;

comment on function public.api_key_has_scope(text[], text) is
  'Returns true if p_scopes grants p_required (mcp:write implies mcp:read). search_path locked per 0011_function_search_path_mutable advisor (Wave S follow-up, 2026-04-23).';
