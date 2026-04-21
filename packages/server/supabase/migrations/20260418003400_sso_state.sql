-- v4.1: Real SAML/OIDC integration with Supabase Auth Admin API.
--
-- Until now, `enterprise_sso_configs` stored config metadata only — admins
-- entered an IdP metadata URL but no provider was ever registered with
-- Supabase Auth, so users could never actually sign in via SSO.
--
-- This migration:
--   1. Adds Supabase-Auth-side fields to `enterprise_sso_configs` so the
--      app can correlate its config row with the canonical `auth.sso_providers`
--      row and surface registration status (pending / registered / failed).
--   2. Introduces `sso_state` for transient login-flow state — nonces, RelayState
--      values, and per-attempt audit trail for SAML AuthnRequest / OIDC
--      authorization-code flow. Required so the relay endpoint can verify
--      callbacks aren't replayed and tie a login back to a project.
--   3. Adds RLS so each project owner can only see their own SSO state +
--      configs.

alter table enterprise_sso_configs
  add column if not exists sso_provider_id uuid,
  add column if not exists registration_status text not null default 'pending'
    check (registration_status in ('pending','registered','failed','disabled')),
  add column if not exists registration_error text,
  add column if not exists registered_at timestamptz,
  add column if not exists domains text[] not null default array[]::text[];

create unique index if not exists idx_sso_configs_provider_id
  on enterprise_sso_configs(sso_provider_id) where sso_provider_id is not null;

-- Per-attempt SSO state. A row is created when the user clicks "Sign in with
-- <Provider>" and consumed (or expired) when the IdP redirects back. We keep
-- the row around for 24h after expiry so audit trails can correlate failures.
create table if not exists sso_state (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  config_id uuid references enterprise_sso_configs(id) on delete set null,
  nonce text not null,
  relay_state text,
  redirect_to text,
  status text not null default 'pending'
    check (status in ('pending','consumed','failed','expired')),
  ip_address text,
  user_agent text,
  consumed_user_id uuid,
  failure_reason text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists idx_sso_state_project on sso_state(project_id);
create index if not exists idx_sso_state_nonce on sso_state(nonce);
create index if not exists idx_sso_state_expires on sso_state(expires_at)
  where status = 'pending';

alter table sso_state enable row level security;

-- Owners read-only access to their project's SSO state. Writes go through the
-- service role from Edge Functions so users can never manipulate nonces.
drop policy if exists sso_state_owner_select on sso_state;
create policy sso_state_owner_select on sso_state
  for select
  using (
    exists (
      select 1 from projects p
      where p.id = sso_state.project_id and p.owner_id = (select auth.uid())
    )
  );

-- Same for enterprise_sso_configs — owner can read; service role writes.
drop policy if exists enterprise_sso_configs_owner_select on enterprise_sso_configs;
create policy enterprise_sso_configs_owner_select on enterprise_sso_configs
  for select
  using (
    exists (
      select 1 from projects p
      where p.id = enterprise_sso_configs.project_id and p.owner_id = (select auth.uid())
    )
  );

-- pg_cron: expire stale SSO attempts hourly. Any row past `expires_at` and
-- still pending becomes 'expired' so failure dashboards stay accurate.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'expire_sso_state') then
      perform cron.unschedule('expire_sso_state');
    end if;
    perform cron.schedule(
      'expire_sso_state',
      '*/15 * * * *',
      $cron$
        update sso_state
          set status = 'expired'
          where status = 'pending' and expires_at < now();
      $cron$
    );
  end if;
end
$$;
