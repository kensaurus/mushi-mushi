-- The GitHub App install callback (POST /v1/webhooks/github/app-installation)
-- stores the installation id here when the project has no primary repo yet.
-- The codebase/enable route promotes it onto project_repos.github_app_installation_id
-- (and clears it) when the user registers a repo. Before this column existed the
-- callback's upsert failed silently and install-before-repo never linked.
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS github_app_installation_id_pending BIGINT;

COMMENT ON COLUMN project_settings.github_app_installation_id_pending IS
  'GitHub App installation id received before any primary repo existed; promoted to project_repos.github_app_installation_id on repo registration, then cleared.';
