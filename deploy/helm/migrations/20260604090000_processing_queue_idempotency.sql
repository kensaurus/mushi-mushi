-- Migration: 20260604090000_processing_queue_idempotency
--
-- Adds a unique constraint on (report_id, stage) so the ingestReport helper can
-- use upsert with ON CONFLICT (report_id, stage) DO NOTHING, preventing duplicate
-- stage1 queue entries when the SDK retries after a mid-flight failure.
--
-- Data-pipeline guarantees this enables:
--   Idempotency: re-submitting the same report.id produces exactly one queue row.
--   Atomicity recovery: when a retry detects a duplicate reports.id (23505),
--     it checks for the queue row and re-inserts if missing, ensuring no report
--     is ever permanently stranded without classification.

-- Step 1: deduplicate any existing rows that would violate the constraint.
-- Keeps the newest row per (report_id, stage) pair.
DELETE FROM public.processing_queue pq
WHERE id NOT IN (
  SELECT DISTINCT ON (report_id, stage) id
  FROM public.processing_queue
  ORDER BY report_id, stage, created_at DESC
);

-- Step 2: add the unique constraint idempotently.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_queue_report_stage'
    AND conrelid = 'public.processing_queue'::regclass
  ) THEN
    ALTER TABLE public.processing_queue
      ADD CONSTRAINT uq_queue_report_stage UNIQUE (report_id, stage);
  END IF;
END $$;
