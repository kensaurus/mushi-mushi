-- ============================================================
-- Mushi Mushi v2 — synthetic-monitor mutation gate
--
-- The 2026-05-04 audit caught that the documented `allow_mutations`
-- flag was never wired through to a column, so the synthetic-monitor
-- cron would fire DELETE / PATCH / PUT against the customer's
-- production app whenever an `action` node declared one of those verbs.
-- This migration adds the column with a fail-closed default (false)
-- and the synthetic-monitor edge function now refuses to dispatch
-- mutating verbs unless this flag is set.
--
-- Operators that want full coverage point the monitor at a sandbox /
-- test-environment URL and then opt in. Production targets stay safe
-- by default. Because there's no cleanup to do (the flag was never
-- present), this is a pure additive change with no data backfill.
-- ============================================================

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS synthetic_monitor_allow_mutations BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN project_settings.synthetic_monitor_allow_mutations IS
  'When false (default), the synthetic monitor only exercises GET/HEAD/OPTIONS verbs. '
  'Set to true ONLY when synthetic_monitor_target_url points at a sandboxed/test environment '
  'where data loss from POST/PATCH/DELETE/PUT is acceptable. Whitepaper §4.4 + audit 2026-05-04.';
