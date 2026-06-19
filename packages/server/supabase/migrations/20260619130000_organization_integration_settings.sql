-- Migration: organization_integration_settings
-- Purpose: Org-level integration credential defaults. Projects that have no
--          per-project credential for a given field inherit the org value via
--          resolveEffectivePlatformSettings(). All secret-shaped fields are
--          vault refs (vault://<uuid>) written by the PUT endpoint.
--
-- Access model:
--   • service-role: full access (edge functions, probes, fix-worker)
--   • authenticated: owner of the org may read/write their own row via RPC;
--     direct table access blocked by RESTRICTIVE deny-all.

create table if not exists organization_integration_settings (
  organization_id  uuid primary key references organizations(id) on delete cascade,

  -- Sentry
  sentry_org_slug             text,
  sentry_project_slug         text,
  sentry_auth_token_ref       text,   -- vault://uuid
  sentry_dsn                  text,
  sentry_webhook_secret       text,   -- vault://uuid

  -- Langfuse
  langfuse_host               text,
  langfuse_public_key_ref     text,   -- vault://uuid
  langfuse_secret_key_ref     text,   -- vault://uuid

  -- GitHub (code repo / fix-worker)
  github_repo_url             text,
  github_default_branch       text default 'main',
  github_installation_token_ref text, -- vault://uuid
  github_webhook_secret       text,   -- vault://uuid
  github_deploy_key           text,   -- vault://uuid

  -- Cursor Cloud fix agent
  cursor_api_key_ref          text,   -- vault://uuid
  cursor_default_model        text,
  cursor_auto_create_pr       boolean default true,
  cursor_max_iterations       integer default 1,

  -- Claude Code fix agent
  claude_api_key_ref          text,   -- vault://uuid
  claude_default_model        text,
  claude_workflow_event       text,
  claude_default_branch       text,

  updated_at  timestamptz not null default now()
);

-- Auto-update updated_at on any write
create or replace function _set_organization_integration_settings_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_integration_settings_updated_at
  on organization_integration_settings;

create trigger trg_org_integration_settings_updated_at
  before update on organization_integration_settings
  for each row execute function _set_organization_integration_settings_updated_at();

-- RLS: RESTRICTIVE deny-all for all non-service-role callers.
-- Edge functions run as service-role and bypass RLS.
-- Authenticated org owners go through the /org/integrations/platform/:kind RPC,
-- never through direct table access.
alter table organization_integration_settings enable row level security;

create policy org_integration_settings_deny_all
  on organization_integration_settings
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Index for the common lookup pattern (project → org → merge)
create index if not exists idx_org_integration_settings_org_id
  on organization_integration_settings(organization_id);

comment on table organization_integration_settings is
  'Org-level integration credential defaults. Per-project project_settings values take precedence; unset fields fall back to this row via resolveEffectivePlatformSettings().';
