-- Align a fresh install with the hosted database.
--
-- Three changes reached the hosted project without a migration file
-- (2026-07-14, 2026-07-28, 2026-08-07). This file replays them so a self-hosted
-- install built from this folder ends in the same state. Every statement is
-- idempotent: on the hosted project it changes nothing.
--
-- REVOKE ... FROM PUBLIC does not remove explicit role grants, and new
-- functions in `public` get explicit EXECUTE grants for anon and authenticated
-- by default. Revoke from each role, then grant only what the callers need.

-- Activity summaries: the api edge function (service role) only, as on the
-- hosted project.
revoke execute on function public.project_activity_summary(uuid, integer) from public, anon, authenticated;
revoke execute on function public.org_portfolio_summary(uuid) from public, anon, authenticated;
grant execute on function public.project_activity_summary(uuid, integer) to service_role;
grant execute on function public.org_portfolio_summary(uuid) to service_role;

-- Vault writes: edge functions (service role) only.
revoke execute on function public.vault_store_secret(text, text, uuid) from public, anon, authenticated;
grant execute on function public.vault_store_secret(text, text, uuid) to service_role;

-- The pooled-credential "last used" column (already added by 20260806052917
-- on most installs; kept here so the comment matches the hosted project).
alter table public.byok_keys
  add column if not exists last_used_at timestamptz;

comment on column public.byok_keys.last_used_at is
  'Timestamp of the latest successful provider call completed with this pooled credential.';

notify pgrst, 'reload schema';
