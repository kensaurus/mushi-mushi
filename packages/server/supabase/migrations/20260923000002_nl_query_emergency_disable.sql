-- SECURITY (2026-09-23): stop execute_readonly_query from running caller-authored
-- SQL as the table owner while the role-contained replacement is built. The
-- in-function blocklist was bypassable (quoted schema names, request.* GUCs) and
-- the "$1" text check did not scope rows. Both /v1/admin/query endpoints return
-- QUERY_ERROR until 20260923000003_nl_query_role_containment lands.
create or replace function public.execute_readonly_query(query_text text, project_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Data queries are temporarily unavailable (security maintenance).';
end;
$$;

revoke all on function public.execute_readonly_query(text, uuid) from public;
revoke all on function public.execute_readonly_query(text, uuid) from anon;
revoke all on function public.execute_readonly_query(text, uuid) from authenticated;
grant execute on function public.execute_readonly_query(text, uuid) to service_role;
