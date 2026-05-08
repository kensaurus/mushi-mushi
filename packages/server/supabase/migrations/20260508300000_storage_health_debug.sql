-- Add last_health_debug to project_storage_settings so the admin UI can
-- render the most recent probe step-log after a page reload without re-running
-- the check. Column is nullable, server-written only (not in the PUT allow-list).
ALTER TABLE project_storage_settings
  ADD COLUMN IF NOT EXISTS last_health_debug jsonb;

COMMENT ON COLUMN project_storage_settings.last_health_debug IS
  'Structured step log from the last storage health probe. Written by the health-check endpoint; never writable by users.';
