-- ============================================================
-- Mushi Mushi v2 — RLS hardening for the bidirectional inventory.
--
-- Why this exists
-- ───────────────
-- `20260504000000_v2_bidirectional_graph.sql` shipped to production
-- with a SELECT policy shape that has two real problems:
--
--   1. **Owner-only read.** Every `owner_reads_*` policy filters on
--      `projects.owner_id = auth.uid()`. After Teams v1 (`organizations`
--      + `organization_members` + `private.is_project_member`), the
--      project owner is rarely the only person who needs to see the
--      inventory — every non-owner org member of a Pro/Enterprise
--      workspace is locked out today.
--
--   2. **Bare `auth.uid()` re-evaluation per row.** The repo standardised
--      on the `(SELECT auth.uid())` initplan pattern in
--      `20260423040000_wave_t_runtime_config_and_rls_initplan.sql`; the
--      v2 migration regressed it for inventories / gate_runs /
--      gate_findings / synthetic_runs / status_history / sentinel_verdicts.
--
-- Same migration also closes the GraphQL / PostgREST direct-read surface
-- on the new tables. The only intended readers are the Hono Edge
-- Function routes under `/v1/admin/inventory/...` running with the
-- service role, so we revoke the `anon` + `authenticated` grants that
-- `pg_graphql` would otherwise advertise (matching the pattern from
-- `20260430010001_migration_progress_graphql_hardening.sql`).
--
-- This migration is **idempotent** — every policy drop / create + revoke
-- is `IF EXISTS` / `CREATE POLICY` (no `IF NOT EXISTS` for policies on
-- PG <16, so we DROP first), and it touches only the policies + grants,
-- never the table data.
-- ============================================================

-- ----------------------------------------------------------------
-- Helper: re-policy one table to (initplan + is_project_member + revoke).
-- We inline rather than DEFINE+CALL because Supabase migrations run
-- as a single SQL script; a helper function would survive the migration
-- and add a permanent surface we'd have to clean up.
-- ----------------------------------------------------------------

-- inventories ----------------------------------------------------
DROP POLICY IF EXISTS owner_reads_inventories ON inventories;
DROP POLICY IF EXISTS members_read_inventories ON inventories;
CREATE POLICY members_read_inventories
  ON inventories FOR SELECT
  TO authenticated
  USING (private.is_project_member(project_id));

-- service_role_writes_inventories already uses `TO service_role USING(true)`
-- which is correct — leave it as-is.

REVOKE ALL ON inventories FROM anon, authenticated;

-- gate_runs ------------------------------------------------------
DROP POLICY IF EXISTS owner_reads_gate_runs ON gate_runs;
DROP POLICY IF EXISTS members_read_gate_runs ON gate_runs;
CREATE POLICY members_read_gate_runs
  ON gate_runs FOR SELECT
  TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON gate_runs FROM anon, authenticated;

-- gate_findings --------------------------------------------------
DROP POLICY IF EXISTS owner_reads_gate_findings ON gate_findings;
DROP POLICY IF EXISTS members_read_gate_findings ON gate_findings;
CREATE POLICY members_read_gate_findings
  ON gate_findings FOR SELECT
  TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON gate_findings FROM anon, authenticated;

-- synthetic_runs -------------------------------------------------
DROP POLICY IF EXISTS owner_reads_synthetic_runs ON synthetic_runs;
DROP POLICY IF EXISTS members_read_synthetic_runs ON synthetic_runs;
CREATE POLICY members_read_synthetic_runs
  ON synthetic_runs FOR SELECT
  TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON synthetic_runs FROM anon, authenticated;

-- status_history -------------------------------------------------
DROP POLICY IF EXISTS owner_reads_status_history ON status_history;
DROP POLICY IF EXISTS members_read_status_history ON status_history;
CREATE POLICY members_read_status_history
  ON status_history FOR SELECT
  TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON status_history FROM anon, authenticated;

-- sentinel_verdicts ----------------------------------------------
DROP POLICY IF EXISTS owner_reads_sentinel_verdicts ON sentinel_verdicts;
DROP POLICY IF EXISTS members_read_sentinel_verdicts ON sentinel_verdicts;
CREATE POLICY members_read_sentinel_verdicts
  ON sentinel_verdicts FOR SELECT
  TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON sentinel_verdicts FROM anon, authenticated;

COMMENT ON POLICY members_read_inventories ON inventories IS
  'Mushi v2 RLS hardening (2026-05-04): replaces owner_reads_inventories so non-owner org members can read project inventory after Teams v1.';
COMMENT ON POLICY members_read_gate_runs ON gate_runs IS
  'Mushi v2 RLS hardening (2026-05-04): see members_read_inventories.';
COMMENT ON POLICY members_read_gate_findings ON gate_findings IS
  'Mushi v2 RLS hardening (2026-05-04): see members_read_inventories.';
COMMENT ON POLICY members_read_synthetic_runs ON synthetic_runs IS
  'Mushi v2 RLS hardening (2026-05-04): see members_read_inventories.';
COMMENT ON POLICY members_read_status_history ON status_history IS
  'Mushi v2 RLS hardening (2026-05-04): see members_read_inventories.';
COMMENT ON POLICY members_read_sentinel_verdicts ON sentinel_verdicts IS
  'Mushi v2 RLS hardening (2026-05-04): see members_read_inventories.';
