-- Fix: execute_readonly_query search_path was set as a single quoted string
-- ('pg_catalog, public') which Postgres interprets as one schema name
-- "pg_catalog, public" — causing "relation reports does not exist" at runtime.
-- The fix drops the quotes so Postgres sees two separate schemas.

create or replace function execute_readonly_query(query_text text, project_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  if query_text ~* '\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|exec|execute|copy|lock|refresh|reindex|vacuum|analyze|cluster|listen|notify|pg_read_server_files|pg_write_server_files|pg_ls_dir|dblink|pg_sleep|pg_terminate_backend|pg_cancel_backend)\b' then
    raise exception 'Only SELECT queries are allowed (blocked keyword)';
  end if;

  if query_text ~* '\b(pg_catalog|information_schema|auth|storage|realtime|supabase_functions|vault|pgsodium|extensions)\s*\.' then
    raise exception 'Query references a restricted schema';
  end if;

  if query_text !~* '^\s*(with\s|select\s)' then
    raise exception 'Only SELECT / WITH queries are permitted';
  end if;

  execute format('select jsonb_agg(row_to_json(t)) from (%s) t', query_text)
    using project_id_param
    into result;

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function execute_readonly_query(text, uuid) from public;
revoke all on function execute_readonly_query(text, uuid) from anon;
revoke all on function execute_readonly_query(text, uuid) from authenticated;
grant execute on function execute_readonly_query(text, uuid) to service_role;
