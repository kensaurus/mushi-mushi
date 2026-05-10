-- Wave S follow-up: lock search_path on `set_updated_at_on_row`.
--
-- The Supabase security advisor flagged `public.set_updated_at_on_row` for
-- `function_search_path_mutable` after the Wave S hardening migration
-- (20260423010000_wave_s_hardening.sql) introduced it as a trigger function.
-- A search_path that inherits the role's default exposes every trigger to
-- SQL-injection-style search-path hijacks — an attacker with any schema-create
-- privilege could shadow `now()` and poison every `updated_at` write.
--
-- The function body only needs `pg_catalog` (for `now()`), so we pin
-- `pg_catalog, pg_temp` — the tightest possible set for a SECURITY DEFINER
-- trigger. The existing `fix_dispatch_jobs_updated_at` trigger continues to
-- resolve the same function oid unchanged (CREATE OR REPLACE preserves it).
create or replace function public.set_updated_at_on_row()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at_on_row() is
  'Generic BEFORE UPDATE trigger that stamps `updated_at = now()`. search_path locked per 0011_function_search_path_mutable advisor (Wave S follow-up, 2026-04-23).';
