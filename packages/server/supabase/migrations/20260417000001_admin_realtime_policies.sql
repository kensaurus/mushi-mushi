-- =============================================================================
-- Add RLS policies for tables that were missing them but are now subscribed to
-- by the admin UI via realtime: reporter_devices and reporter_notifications.
-- Without policies, RLS-enabled tables block all reads, so the realtime stream
-- would silently deliver zero rows to the admin pages.
--
-- Service role keeps full write access; authenticated users only see rows for
-- projects they own. Without this scoping, any authenticated user could read
-- every other tenant's reporter devices and notifications.
-- =============================================================================

drop policy if exists "service_role_writes_reporter_devices" on reporter_devices;
create policy "service_role_writes_reporter_devices"
  on reporter_devices for all
  to service_role
  using (true) with check (true);

drop policy if exists "authenticated_reads_reporter_devices" on reporter_devices;
drop policy if exists "owner_reads_reporter_devices" on reporter_devices;
create policy "owner_reads_reporter_devices"
  on reporter_devices for select
  to authenticated
  using (
    exists (
      select 1 from projects p
      where p.id = reporter_devices.project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "service_role_writes_reporter_notifications" on reporter_notifications;
create policy "service_role_writes_reporter_notifications"
  on reporter_notifications for all
  to service_role
  using (true) with check (true);

drop policy if exists "authenticated_reads_reporter_notifications" on reporter_notifications;
drop policy if exists "owner_reads_reporter_notifications" on reporter_notifications;
create policy "owner_reads_reporter_notifications"
  on reporter_notifications for select
  to authenticated
  using (
    exists (
      select 1 from projects p
      where p.id = reporter_notifications.project_id and p.owner_id = auth.uid()
    )
  );
