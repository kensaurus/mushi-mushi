-- Rollback for 20261003110000_design_deviance_actions.
-- Roll the api and recipe-collector functions back first: they read these
-- columns, and a missing column makes the design actions report
-- settings_unavailable (the CI gate then never fails, and no fix dispatches).

ALTER TABLE public.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_design_deviance_threshold_range;

ALTER TABLE public.project_settings
  DROP COLUMN IF EXISTS design_drift_autofix,
  DROP COLUMN IF EXISTS design_deviance_fail_ci,
  DROP COLUMN IF EXISTS design_deviance_threshold;
