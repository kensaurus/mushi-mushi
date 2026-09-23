-- SECURITY (2026-09-23): run caller-authored analytics SQL as a role that can
-- only see the caller's project, instead of as the table owner.
--
-- Before: execute_readonly_query was SECURITY DEFINER owned by postgres, so the
-- query ignored RLS and could read any tenant, the vault schema and auth.users.
-- The only tenant scoping was a text check that "$1" appeared somewhere
-- (nl-query.ts), and the in-function blocklist used `\b`, which in a Postgres
-- regex is a backspace, so it never matched anything.
--
-- After:
--   * The query runs inside mushi_nl.run, a SECURITY DEFINER function owned by
--     mushi_nl_reader: no BYPASSRLS, SELECT on the analytics allowlist only, no
--     usage on vault/auth/storage, no other public tables.
--   * RLS on each allowlisted table limits mushi_nl_reader to rows of the one
--     project the outer function wrote into a transaction-local temp table.
--     The query cannot change that value: it cannot write the table, and the
--     scope is read by a definer function, not from a GUC it could set.
--   * PostgREST's request.* settings (headers carry the service-role key) are
--     blanked before the query runs.
--   * The keyword/schema guards are kept as defence in depth, with Postgres
--     word boundaries (\m \M), and quoted identifiers are refused.

-- 1. The low-privilege role. postgres needs SET membership to hand it a
--    function (ALTER ... OWNER TO), but does not inherit its privileges.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mushi_nl_reader') then
    create role mushi_nl_reader nologin noinherit;
  end if;
end
$$;
grant mushi_nl_reader to postgres with set true, inherit false;

create schema if not exists mushi_nl;
revoke all on schema mushi_nl from public;

-- 2. The scope the policies read. Definer = postgres so mushi_nl_reader needs no
--    grant on the temp table (and so cannot write it).
create or replace function public.nl_query_scope()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  execute 'select project_id from pg_temp.mushi_nl_scope limit 1' into v;
  return v;
exception when undefined_table then
  return null;
end;
$$;
revoke all on function public.nl_query_scope() from public, anon, authenticated, service_role;
grant execute on function public.nl_query_scope() to mushi_nl_reader;

-- 3. Read access for mushi_nl_reader: the raw-SQL allowlist in nl-query.ts,
--    scoped to one project. A restrictive twin keeps the scope even if a
--    permissive policy for PUBLIC is added to one of these tables later.
do $$
declare
  t text;
begin
  foreach t in array array[
    'reports', 'report_groups', 'classification_evaluations', 'reporter_reputation',
    'reporter_devices', 'graph_nodes', 'graph_edges', 'bug_ontology', 'fix_attempts',
    'fix_events', 'llm_invocations', 'anti_gaming_events'
  ] loop
    execute format('grant select on public.%I to mushi_nl_reader', t);
    execute format('drop policy if exists nl_reader_select on public.%I', t);
    execute format('drop policy if exists nl_reader_scope on public.%I', t);
    execute format(
      'create policy nl_reader_select on public.%I as permissive for select to mushi_nl_reader '
      'using (project_id = (select public.nl_query_scope()))', t);
    execute format(
      'create policy nl_reader_scope on public.%I as restrictive for select to mushi_nl_reader '
      'using (project_id = (select public.nl_query_scope()))', t);
  end loop;
end
$$;

-- fix_verifications has no project_id; scope it through its report.
grant select on public.fix_verifications to mushi_nl_reader;
drop policy if exists nl_reader_select on public.fix_verifications;
drop policy if exists nl_reader_scope on public.fix_verifications;
create policy nl_reader_select on public.fix_verifications as permissive for select to mushi_nl_reader
  using (report_id in (select r.id from public.reports r where r.project_id = (select public.nl_query_scope())));
create policy nl_reader_scope on public.fix_verifications as restrictive for select to mushi_nl_reader
  using (report_id in (select r.id from public.reports r where r.project_id = (select public.nl_query_scope())));

-- 4. The inner executor. Created by postgres with its ACL already locked, then
--    handed to mushi_nl_reader so the caller's SQL runs with that role's
--    privileges. The owner change needs CREATE on the schema for the new
--    owner; it is granted only for that statement.
create or replace function mushi_nl.run(query_text text, project_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  execute format('select jsonb_agg(row_to_json(t)) from (%s) t', query_text)
    using project_id_param
    into result;
  return coalesce(result, '[]'::jsonb);
end;
$$;
revoke all on function mushi_nl.run(text, uuid) from public, anon, authenticated, service_role;
grant execute on function mushi_nl.run(text, uuid) to postgres;
grant create on schema mushi_nl to mushi_nl_reader;
alter function mushi_nl.run(text, uuid) owner to mushi_nl_reader;
revoke create on schema mushi_nl from mushi_nl_reader;

-- 5. The entry point the edge functions call (service_role only).
create or replace function public.execute_readonly_query(query_text text, project_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '5s'
as $$
declare
  result jsonb;
  s record;
begin
  if project_id_param is null then
    raise exception 'project_id_param is required';
  end if;

  -- Defence in depth only; mushi_nl_reader's privileges are the boundary.
  if query_text !~* '^\s*(with|select)\M' then
    raise exception 'Only SELECT / WITH queries are permitted';
  end if;
  if position('"' in query_text) > 0 then
    raise exception 'Quoted identifiers are not allowed';
  end if;
  if query_text ~* '\m(insert|update|delete|merge|drop|truncate|alter|create|grant|revoke|exec|execute|copy|lock|refresh|reindex|vacuum|analyze|cluster|listen|notify|prepare|deallocate|discard|reset|set_config|current_setting|pg_notify|pg_settings|pg_show_all_settings|pg_db_role_setting|pg_stat_activity|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_advisory_lock|pg_advisory_xact_lock|lo_import|lo_export|lo_create|lo_from_bytea|lo_put|query_to_xml|query_to_xml_and_xmlschema|cursor_to_xml|table_to_xml|schema_to_xml|database_to_xml|dblink|nl_query_scope)\M' then
    raise exception 'Only SELECT queries are allowed (blocked keyword)';
  end if;
  if query_text ~* '\m(pg_catalog|information_schema|pg_temp|pg_toast|auth|storage|realtime|supabase_functions|supabase_migrations|vault|pgsodium|extensions|net|cron|graphql|graphql_public|pgbouncer|pgmq|mushi_nl)\s*\.' then
    raise exception 'Query references a restricted schema';
  end if;

  -- PostgREST exposes the caller's request (including the Authorization
  -- header) as transaction settings. Blank them before running caller SQL.
  perform set_config('request.headers', '{}', true);
  perform set_config('request.cookies', '{}', true);
  perform set_config('request.jwt.claims', '{}', true);
  for s in select name from pg_settings where name like 'request.%' loop
    perform set_config(s.name, '', true);
  end loop;

  drop table if exists pg_temp.mushi_nl_scope;
  create temporary table mushi_nl_scope (project_id uuid not null) on commit drop;
  insert into pg_temp.mushi_nl_scope (project_id) values (project_id_param);

  result := mushi_nl.run(query_text, project_id_param);

  drop table if exists pg_temp.mushi_nl_scope;
  return result;
end;
$$;

revoke all on function public.execute_readonly_query(text, uuid) from public;
revoke all on function public.execute_readonly_query(text, uuid) from anon;
revoke all on function public.execute_readonly_query(text, uuid) from authenticated;
grant execute on function public.execute_readonly_query(text, uuid) to service_role;
