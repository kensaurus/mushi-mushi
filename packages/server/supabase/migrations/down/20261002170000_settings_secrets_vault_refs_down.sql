-- Rollback for 20261002170000_settings_secrets_vault_refs.
-- Drops the vault-ref guards only. The columns keep their `vault://` refs on
-- purpose: every reader resolves them, and copying the secrets back into
-- plaintext columns would undo the point of the migration.

ALTER TABLE public.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_github_installation_token_ref_is_vault_ref,
  DROP CONSTRAINT IF EXISTS project_settings_github_webhook_secret_is_vault_ref,
  DROP CONSTRAINT IF EXISTS project_settings_github_deploy_key_is_vault_ref,
  DROP CONSTRAINT IF EXISTS project_settings_sentry_webhook_secret_is_vault_ref,
  DROP CONSTRAINT IF EXISTS project_settings_regen_webhook_secret_is_vault_ref;

ALTER TABLE public.organization_integration_settings
  DROP CONSTRAINT IF EXISTS org_settings_github_installation_token_ref_is_vault_ref,
  DROP CONSTRAINT IF EXISTS org_settings_github_webhook_secret_is_vault_ref,
  DROP CONSTRAINT IF EXISTS org_settings_github_deploy_key_is_vault_ref,
  DROP CONSTRAINT IF EXISTS org_settings_sentry_webhook_secret_is_vault_ref;
