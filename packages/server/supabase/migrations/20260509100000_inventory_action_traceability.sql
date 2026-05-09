-- ============================================================
-- Migration: 20260509100000_inventory_action_traceability
--
-- Purpose
-- ───────
-- Close the v2 spec-traceability gap on the WRITE side of the loop:
-- the read side (proposer → ingest → status-reconciler → admin UI) was
-- already wiring reports to inventory Actions via the
-- `reports_against` graph edge that classify-report writes — but the
-- fix dispatch path (`POST /v1/admin/fixes/dispatch` → fix-worker →
-- GitHub PR → fix_attempts) never persisted that link, so the agent
-- review prompt and the post-PR audit had no way to recover which
-- inventory Action a fix was meant to repair.
--
-- This migration adds an OPTIONAL inventory_action_node_id FK to both
-- of the fix tables. The fix-worker fills it from the
-- reports_against edge at dispatch time; downstream consumers
-- (orchestrator, review prompt, judge, synthetic monitor's targeted
-- post-PR probe) read it back via a single FK join instead of having
-- to re-traverse the graph.
--
-- Posture
-- ───────
-- - Nullable: legacy reports without an inventory linkage still
--   dispatch and complete; the column is just NULL for them.
-- - ON DELETE SET NULL: if a customer prunes inventory entries the
--   fix history MUST stay readable for compliance (whitepaper §6
--   audit retention) — losing the historical link is the right
--   trade-off vs. cascading the delete.
-- - Indexed for the "show me every fix that touched this Action"
--   admin query that the User-Story-Map drawer will use.
-- ============================================================

ALTER TABLE fix_dispatch_jobs
  ADD COLUMN IF NOT EXISTS inventory_action_node_id UUID
    REFERENCES graph_nodes(id) ON DELETE SET NULL;

ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS inventory_action_node_id UUID
    REFERENCES graph_nodes(id) ON DELETE SET NULL,
  -- Soft warnings from validateAgainstSpec (orchestrator + fix-worker).
  -- Hard errors flip status to 'failed' with the message stuffed into the
  -- existing `error` column; warnings are advisory and surface in the
  -- admin Fixes drawer so reviewers can see "this fix didn't reference
  -- the inventory's required DB table — sanity-check before merging".
  ADD COLUMN IF NOT EXISTS spec_validation_warnings JSONB;

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_jobs_inventory_action
  ON fix_dispatch_jobs (inventory_action_node_id, created_at DESC)
  WHERE inventory_action_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fix_attempts_inventory_action
  ON fix_attempts (inventory_action_node_id, created_at DESC)
  WHERE inventory_action_node_id IS NOT NULL;

COMMENT ON COLUMN fix_dispatch_jobs.inventory_action_node_id IS
  'graph_nodes.id of the inventory Action node this fix was dispatched against. Recovered from the reports_against edge at dispatch time. NULL when the report has no inventory linkage (legacy reports or projects without v2).';

COMMENT ON COLUMN fix_attempts.inventory_action_node_id IS
  'Mirrors fix_dispatch_jobs.inventory_action_node_id so the per-attempt admin queries don''t need a second join. Set by the fix-worker insert; never updated by humans.';
