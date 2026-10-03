-- ADDITIVE: per-project deviance threshold and the two actions a design
-- deviance score may take on its own (Plan 019 Phase 1b follow-up). Both
-- actions are OFF by default; nothing changes for a project until an owner or
-- admin turns one on in the console (Design system → "When the score is too
-- high").
--
--   design_deviance_threshold  0–100; the score above which an action fires.
--   design_deviance_fail_ci    `mushi recipe check --push` exits non-zero when
--                              the pushed score is above the threshold.
--   design_drift_autofix       a scan above the threshold with warn/error
--                              findings that were not in the previous scan
--                              opens (or reuses) one design-drift report and
--                              dispatches a fix through the normal automatic
--                              dispatch path, so autofix_enabled and the
--                              auto-fix spend and per-day caps still apply.
--
-- Columns only, on an existing table that already has RLS; idempotent.

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS design_deviance_threshold smallint NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS design_deviance_fail_ci boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS design_drift_autofix boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_settings_design_deviance_threshold_range'
      AND conrelid = 'public.project_settings'::regclass
  ) THEN
    ALTER TABLE public.project_settings
      ADD CONSTRAINT project_settings_design_deviance_threshold_range
      CHECK (design_deviance_threshold BETWEEN 0 AND 100);
  END IF;
END $$;

COMMENT ON COLUMN public.project_settings.design_deviance_threshold IS
  'Design deviance score (0 on-system … 100) above which the opt-in design actions fire. Default 40.';
COMMENT ON COLUMN public.project_settings.design_deviance_fail_ci IS
  'Opt-in: mushi recipe check --push exits non-zero when the pushed deviance score is above design_deviance_threshold.';
COMMENT ON COLUMN public.project_settings.design_drift_autofix IS
  'Opt-in: above the threshold, new warn/error design_drift findings open one design-drift report and dispatch a fix (trigger automatic; autofix_enabled and the auto-fix caps apply).';
