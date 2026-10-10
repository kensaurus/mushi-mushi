-- ============================================================================
-- 20261010140000_project_settings_linear_organization_id
--
-- webhooks-linear read `organizationId` off every delivery but never used it:
-- both lookup branches selected EVERY project_settings row with a webhook
-- secret, so each delivery dereferenced Vault and computed an HMAC once per
-- installed project. linear-oauth-callback already fetches the workspace's
-- organization id; it now stores it here, and webhooks-linear narrows the
-- candidate set to rows with this organization id (plus legacy rows where it
-- is still null) before checking signatures.
--
-- Nullable, no backfill: installs that predate this column keep working
-- through the null branch until they reconnect.
-- ============================================================================

alter table public.project_settings
  add column if not exists linear_organization_id text;

comment on column public.project_settings.linear_organization_id is
  'Linear organization (workspace) id recorded at OAuth install; webhooks-linear filters candidate projects by it before HMAC verification.';

create index if not exists project_settings_linear_organization_id_idx
  on public.project_settings (linear_organization_id)
  where linear_organization_id is not null;
