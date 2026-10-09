-- SECURITY (2026-09-23): credential and outbound-URL settings are reachable
-- only through the API, which validates them.
--
-- Before: RLS let a project owner UPDATE any project_settings column (and do
-- anything to project_storage_settings) straight through PostgREST, and let any
-- org member SELECT the whole row. That bypassed every server-side check on
-- these columns: vault references could be pointed at another tenant's secret
-- (vault_get_secret resolves by name with the service role), and langfuse_host,
-- byok_openai_base_url, crawler_base_url and the webhook URLs skipped their
-- SSRF validation. Members could also read secrets still stored raw.
-- reward_webhooks was writable by org admins the same way.
--
-- No browser or SDK code touches these tables (the admin console and CLI go
-- through /functions/v1/api); the edge functions use the service role.
-- Revoking a table privilege also revokes its column privileges.
revoke all on table public.project_settings from anon, authenticated;
revoke all on table public.project_storage_settings from anon, authenticated;
revoke all on table public.project_integrations from anon, authenticated;
revoke all on table public.organization_integration_settings from anon, authenticated;
revoke all on table public.reward_webhooks from anon, authenticated;

drop policy if exists settings_owner_update on public.project_settings;
drop policy if exists storage_settings_owner_write on public.project_storage_settings;
drop policy if exists reward_webhooks_org_admin on public.reward_webhooks;
