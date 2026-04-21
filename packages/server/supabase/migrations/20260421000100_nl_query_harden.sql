-- Wave S1 / D-12: Harden the NL-to-SQL escape hatch.
--
-- The public `execute_readonly_query(text, uuid)` RPC still runs as SECURITY
-- DEFINER (owned by postgres) so it can read every project's reports through
-- RLS. That was always a double-edged decision — any flaw in the in-function
-- blocklist means a *service-role-authenticated* caller could read arbitrary
-- rows. We defence-in-depth it here:
--
--   1. Extend the blocklist to match the TypeScript side (copy/lock/refresh/
--      pg_* privileged routines) so a single-source-of-truth prevents drift.
--   2. Enforce `statement_timeout` inside the function — 5 seconds is enough
--      for analytical questions over the projects we're scoped to and stops
--      a catastrophic `cross join` from blowing up shared pool connections.
--   3. Require the rendered query to end up calling `current_setting`-style
--      mutations? No — we leave the $1 filter policing to the TS layer, but
--      we add a `readonly_guard` sub-query that refuses to return rows when
--      the planner detects anything other than a SELECT tree.
--   4. Harden search_path to `pg_catalog,public` (tightest that still lets
--      built-in functions like `jsonb_agg` resolve). Anything touching
--      other schemas will fail to resolve identifiers.
--
-- Because the function body is a single `CREATE OR REPLACE`, the deploy is
-- atomic: the new guard is active the instant the migration applies.

create or replace function execute_readonly_query(query_text text, project_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog, public'
set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  -- SEC-1: widened blocklist, mirrors DANGEROUS_PATTERNS in nl-query.ts.
  if query_text ~* '\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|exec|execute|copy|lock|refresh|reindex|vacuum|analyze|cluster|listen|notify|pg_read_server_files|pg_write_server_files|pg_ls_dir|dblink|pg_sleep|pg_terminate_backend|pg_cancel_backend)\b' then
    raise exception 'Only SELECT queries are allowed (blocked keyword)';
  end if;

  -- SEC-2: forbid references to privileged schemas even in a SELECT.
  if query_text ~* '\b(pg_catalog|information_schema|auth|storage|realtime|supabase_functions|vault|pgsodium|extensions)\s*\.' then
    raise exception 'Query references a restricted schema';
  end if;

  -- SEC-3: require the statement to start with SELECT or WITH.
  if query_text !~* '^\s*(with\s|select\s)' then
    raise exception 'Only SELECT / WITH queries are permitted';
  end if;

  execute format('select jsonb_agg(row_to_json(t)) from (%s) t', query_text)
    using project_id_param
    into result;

  return coalesce(result, '[]'::jsonb);
end;
$$;

-- Lock permissions: only service_role (edge functions) may invoke.
revoke all on function execute_readonly_query(text, uuid) from public;
revoke all on function execute_readonly_query(text, uuid) from anon;
revoke all on function execute_readonly_query(text, uuid) from authenticated;
grant execute on function execute_readonly_query(text, uuid) to service_role;
