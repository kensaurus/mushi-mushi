-- Migration: 20260621000000_extend_event_name_diagnoses.sql
-- PURPOSE: Phase 1 shadow ledger — extend usage_events.event_name CHECK to allow
--          'diagnoses'. The classify-report function now inserts a shadow row
--          (metadata.shadow=true) on every completed Stage-2 classification so we
--          can validate quota sizing on real traffic before Phase 2 changes billing.
--          'reports_ingested', 'fixes_attempted', 'fixes_succeeded', and
--          'classifier_tokens' are all preserved unchanged.

ALTER TABLE usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_name_check;

ALTER TABLE usage_events
  ADD CONSTRAINT usage_events_event_name_check
  CHECK (event_name IN (
    'reports_ingested',
    'fixes_attempted',
    'fixes_succeeded',
    'classifier_tokens',
    'diagnoses'          -- Phase 1 shadow, Phase 2 metered billing unit
  ));
