-- Phase 0.1: Extend CHECK constraint on enterprise_sso_configs.registration_status
-- to allow the 'manual_required' value that the OIDC handler writes.

ALTER TABLE enterprise_sso_configs
  DROP CONSTRAINT IF EXISTS enterprise_sso_configs_registration_status_check;

ALTER TABLE enterprise_sso_configs
  ADD CONSTRAINT enterprise_sso_configs_registration_status_check
  CHECK (registration_status IN ('pending', 'registered', 'failed', 'disabled', 'manual_required'));
