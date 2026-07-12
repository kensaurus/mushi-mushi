-- ============================================================
-- Fix double-billed diagnoses (classify-report duplicated its
-- usage_events insert block, metering every fresh Stage-2
-- classification twice).
--
-- 1. Remove existing duplicate 'diagnoses' rows, keeping the
--    earliest row per report (deterministic winner).
-- 2. Enforce at-most-one 'diagnoses' event per report with a
--    partial unique index on the metadata report_id, so a code
--    regression can never double-bill again (second insert fails
--    and is only warn-logged by the fire-and-forget caller).
-- ============================================================

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id, metadata->>'report_id'
           ORDER BY occurred_at ASC, id ASC
         ) AS rn
  FROM usage_events
  WHERE event_name = 'diagnoses'
    AND metadata->>'report_id' IS NOT NULL
)
DELETE FROM usage_events
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_events_diagnoses_report
  ON usage_events ((metadata->>'report_id'))
  WHERE event_name = 'diagnoses' AND metadata->>'report_id' IS NOT NULL;
