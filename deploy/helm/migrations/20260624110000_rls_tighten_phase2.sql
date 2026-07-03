-- Migration: RLS tighten phase 2 (R3 + R4 + R5)
-- Drops the cross-tenant USING(true) SELECT policies from cron_runs,
-- reporter_devices, and reporter_notifications.
--
-- cron_runs: no project_id column; these are internal cron pipeline logs
--   read exclusively via service-role inside edge functions. After this drop,
--   only the service_role_writes_cron_runs (ALL) policy remains, meaning no
--   authenticated client can read the table directly.
--
-- reporter_devices / reporter_notifications: both tables already have a
--   correctly-scoped "org_member_select" (USING private.is_project_member)
--   that restricts reads to project members. The USING(true) policy was
--   making the permissive one win and exposing device fingerprints and
--   notification payloads across all projects.

-- R3: cron_runs
DROP POLICY IF EXISTS "authenticated_reads_cron_runs" ON public.cron_runs;

-- R4: reporter_devices
DROP POLICY IF EXISTS "authenticated_reads_reporter_devices" ON public.reporter_devices;

-- R5: reporter_notifications
DROP POLICY IF EXISTS "authenticated_reads_reporter_notifications" ON public.reporter_notifications;
