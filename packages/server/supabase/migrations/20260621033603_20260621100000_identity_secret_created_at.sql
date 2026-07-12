/*
FILE: 20260621100000_identity_secret_created_at.sql
PURPOSE: Add identity_secret_created_at to project_settings for the
         identity-secret self-service API (Phase 3).

OVERVIEW:
- Tracks when the identity signing secret was last rotated/minted.
- Displayed in the IdentitySecretCard console UI alongside rotation controls.
- The column stores only a timestamp — the raw secret lives in Vault.

NOTES:
- assistant_identity_secret_ref was added in 20260618120000.
- No RLS changes needed; project_settings is service-role only.
*/

alter table project_settings
  add column if not exists identity_secret_created_at timestamptz;

comment on column project_settings.identity_secret_created_at is
  'When the identity signing secret (assistant_identity_secret_ref) was last minted or rotated via the console API.';

notify pgrst, 'reload schema';
