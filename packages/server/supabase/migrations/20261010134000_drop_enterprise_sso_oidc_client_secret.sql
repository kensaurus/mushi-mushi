-- ============================================================================
-- 20261010134000_drop_enterprise_sso_oidc_client_secret
--
-- 20260527110000_enterprise_sso_oidc_fields added a plaintext
-- enterprise_sso_configs.oidc_client_secret column. Nothing reads or writes
-- it: the OIDC record (_shared/sso-oidc-record.ts) never stores the client
-- secret and the route refuses a request that sends one. A secret-named
-- plaintext column in public invites someone to store a real secret there,
-- so it goes. It held no values on the hosted project when this was written.
-- oidc_client_id and oidc_issuer_url stay (not secrets).
-- ============================================================================

alter table public.enterprise_sso_configs
  drop column if exists oidc_client_secret;
