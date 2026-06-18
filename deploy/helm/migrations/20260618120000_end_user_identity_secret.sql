/*
FILE: 20260618120000_end_user_identity_secret.sql
PURPOSE: Per-project signed-JWT end-user identity (Workstream A).

OVERVIEW:
- Adds project_settings.assistant_identity_secret_ref — a Vault secret id
  holding the HS256 signing secret the host app uses to mint end-user
  identity tokens (Mushi.identifyWithToken). The backend loads it via
  vault_get_secret to verify the X-Mushi-User-Token header.
- The column stores only the Vault *reference*, never the raw secret.

NOTES:
- The secret itself is created with vault_store_secret from the rewards/
  settings API (returned once on rotation, API-key style).
- end_users already carries jwt_provider / jwt_subject / jwt_verified_at,
  which the verified-token upsert populates.
*/

alter table project_settings
  add column if not exists assistant_identity_secret_ref text;

comment on column project_settings.assistant_identity_secret_ref is
  'Vault secret id for the per-project HS256 end-user identity signing secret (Workstream A). Never stores the raw secret.';

notify pgrst, 'reload schema';
