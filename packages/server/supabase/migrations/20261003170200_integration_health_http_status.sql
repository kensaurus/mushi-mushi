-- ============================================================================
-- 20261003170200_integration_health_http_status
--
-- Plan 020 §4.2 Phase 2 detector `provider_key_invalid`. ADDITIVE: apply
-- BEFORE deploying the integration-health-probe and api functions that write
-- this column, and the radar-scan function that reads it.
--
-- integration_health_history kept only ok | degraded | down | unknown plus a
-- free-text message, so a key the vendor rejected (401) could not be told
-- apart from a vendor outage without parsing that text. The probes already
-- know the HTTP status; this stores it.
--
--   integration_health_history.http_status   the vendor's HTTP status for the
--                                            probe; null when the probe sent no
--                                            request or threw before a response,
--                                            and for rows written before this
--                                            migration
--
-- RLS: the table already has RLS (members_read_health); a new column inherits
-- it. No credential is stored here.
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'integration_health_history' and column_name = 'http_status';  -- 1 row
-- ============================================================================

alter table public.integration_health_history
  add column if not exists http_status integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'integration_health_history_http_status_valid') then
    alter table public.integration_health_history
      add constraint integration_health_history_http_status_valid
      check (http_status is null or http_status between 100 and 599);
  end if;
end $$;

comment on column public.integration_health_history.http_status is
  'Vendor HTTP status of the probe (401 = key rejected, 403 = permission missing). Null = no response, or written before 20261003170200.';

notify pgrst, 'reload schema';
