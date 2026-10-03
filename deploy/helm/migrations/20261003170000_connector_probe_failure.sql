-- ============================================================================
-- 20261003170000_connector_probe_failure
--
-- Plan 020 §4.2 Phase 2 detectors (`provider_key_invalid`,
-- `store_credential_scope_missing`). ADDITIVE: apply BEFORE deploying the api,
-- recipe-collector and radar-scan functions that write and read these columns.
--
-- Until now a connector probe stored only the scopes it was granted, and a
-- failed snapshot stored only a sentence. The radar needs to know WHY a
-- vendor said no, without parsing that sentence:
--
--   connector_instances.missing_scopes      what the last probe found missing
--                                           (null = probed before this column)
--   connector_instances.last_probe_failure  credential_rejected (401) |
--                                           permission_missing (403) | not_found |
--                                           rate_limited | vendor_error | other
--   connector_snapshots.error_kind          the same classification for a failed
--                                           daily snapshot
--
-- Members may read the two new connector_instances columns (column grant,
-- like the other non-credential columns). No credential is stored here.
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'connector_instances' and column_name in ('missing_scopes', 'last_probe_failure');  -- 2 rows
--   select column_name from information_schema.columns
--    where table_name = 'connector_snapshots' and column_name = 'error_kind';                              -- 1 row
--   select has_column_privilege('authenticated', 'public.connector_instances', 'missing_scopes', 'select');  -- t
--   select has_column_privilege('authenticated', 'public.connector_instances', 'read_credential_ref', 'select');  -- still f
-- ============================================================================

alter table public.connector_instances
  add column if not exists missing_scopes text[],
  add column if not exists last_probe_failure text;

alter table public.connector_snapshots
  add column if not exists error_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'connector_instances_last_probe_failure_valid') then
    alter table public.connector_instances
      add constraint connector_instances_last_probe_failure_valid
      check (last_probe_failure is null or last_probe_failure in
        ('credential_rejected', 'permission_missing', 'not_found', 'rate_limited', 'vendor_error', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'connector_snapshots_error_kind_valid') then
    alter table public.connector_snapshots
      add constraint connector_snapshots_error_kind_valid
      check (error_kind is null or error_kind in
        ('credential_rejected', 'permission_missing', 'not_found', 'rate_limited', 'vendor_error', 'other'));
  end if;
end $$;

grant select (missing_scopes, last_probe_failure) on public.connector_instances to authenticated;

comment on column public.connector_instances.missing_scopes is
  'Scopes the last probe found missing (Plan 020 store_credential_scope_missing). Null = probed before 20261003170000.';
comment on column public.connector_instances.last_probe_failure is
  'Why the last probe failed, from the vendor HTTP status (401 credential_rejected, 403 permission_missing, ...). Null when it succeeded.';
comment on column public.connector_snapshots.error_kind is
  'Why a failed snapshot failed, from the vendor HTTP status; null for ok snapshots and failures with no status.';

notify pgrst, 'reload schema';
