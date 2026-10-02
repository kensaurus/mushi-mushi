-- Rollback for 20261002140200_autofix_default_caps.
-- Projects created while the defaults were live keep their caps; clear them
-- per project with PUT /v1/admin/projects/:id/autofix/caps if needed.

ALTER TABLE public.project_settings
  ALTER COLUMN autofix_max_spend_usd DROP DEFAULT,
  ALTER COLUMN autofix_max_dispatches_per_day DROP DEFAULT;
