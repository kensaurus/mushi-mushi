-- Objects the hosted Mushi Mushi database has from outside the migration history
-- (created by the Supabase platform or by hand before a migration recorded them).
-- A fresh self-hosted database runs this once, before the migrations.
-- Everything here is idempotent and safe to re-run.

-- Supabase's hosted platform installs this event-trigger function; migrations
-- 20260511120500 and 20260527020000 revoke grants on it.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- Self-hosted: a no-op. Mushi's own migrations enable RLS table by table.
  return;
end;
$$;

-- Revoked in 20260511130000 and 20260527020000; never created by a migration.
-- Project owners are added to project_members by the API itself
-- (api/routes/projects-crud.ts, api/routes/cli-auth.ts), so no trigger uses this.
create or replace function public.project_members_autoadd_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return new;
end;
$$;

-- The internal-call helpers (mushi.cron_http_post, mushi.edge_function_post,
-- mushi.edge_function_calls) live in this schema, which no migration creates.
create schema if not exists mushi;

-- Used by triggers in 20260520000000_mistake_clusters.sql; never created by a migration.
create schema if not exists private;
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
