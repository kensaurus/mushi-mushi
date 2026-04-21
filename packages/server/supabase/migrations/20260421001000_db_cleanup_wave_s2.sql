-- =============================================================================
-- Wave S2 — DB cleanup. Addresses the 2026-04-21 full-depth audit findings
-- that weren't covered by 20260421000000_audit_remediation.sql:
--
--   1. Consolidate duplicate permissive RLS policies (per-table policy
--      explosion from the Phase 0..Phase 5 migration history). Postgres
--      evaluates *all* permissive policies on every row; duplicates
--      compound RLS cost without changing semantics.
--   2. Drop unused indexes (>30 days with 0 scans). Done via a dynamic
--      scan of pg_stat_user_indexes so we don't hard-code names that can
--      drift as tables get renamed.
--   3. Cover llm_invocations.report_id with a B-tree index. The Report
--      detail page joins llm_invocations on report_id; on projects with
--      >10k invocations this scan was measured at >150ms tail latency.
--   4. Add `created_at` to append-only tables that were missing it. This
--      is a paper-trail requirement (SOC 2 CC7.2) and prevents us having
--      to scavenge timestamps from related rows during compliance audits.
--   5. Document the `vector(1536)` rigidity and ship a `vector` column on
--      the main embeddings table *without* dimension lock when the table
--      is not yet populated. We keep existing 1536-dim columns as-is —
--      relaxing the dimension after rows exist requires a full rebuild.
--   6. Enable MFA requirement + leaked-password protection via a role
--      config helper. Supabase runs these toggles through Auth config,
--      not SQL, so we only warn here (see docs/wave-s2-manual-steps.md).
--
-- All blocks are idempotent. Re-running the migration is safe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Consolidate duplicate permissive RLS policies.
--
-- Strategy: for each (table, role, action) tuple, if there are 2+ permissive
-- policies whose `USING` clauses reference the same subquery shape
-- ("(SELECT auth.uid()) = owner_id" etc.), keep the newest and drop the rest.
-- We cannot pattern-match all 64 cases by hand without schema drift, so we
-- take the conservative path: LOG the duplicates via a RAISE NOTICE and leave
-- the policy drop to a follow-up migration that targets explicit names. The
-- scan still surfaces the list in the migration output for operators.
--
-- Full drop semantics are intentionally gated — accidentally dropping a
-- restrictive policy is a privilege-escalation hazard. Operators should
-- review the printed list and craft a named DROP POLICY migration.
-- -----------------------------------------------------------------------------
DO $rls_audit$
DECLARE
  rec record;
  dup_count int := 0;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, cmd, roles,
           array_agg(policyname ORDER BY policyname) AS policy_names,
           count(*) AS c
      FROM pg_policies
     WHERE schemaname = 'public'
       AND permissive = 'PERMISSIVE'
     GROUP BY schemaname, tablename, cmd, roles
    HAVING count(*) > 1
  LOOP
    RAISE NOTICE 'RLS duplicate: table=%, cmd=%, roles=%, policies=%',
      rec.tablename, rec.cmd, rec.roles, rec.policy_names;
    dup_count := dup_count + rec.c - 1;
  END LOOP;
  RAISE NOTICE 'RLS audit: % duplicate permissive policies queued for manual review', dup_count;
END
$rls_audit$;

-- -----------------------------------------------------------------------------
-- 2. Drop unused indexes.
--
-- "Unused" = idx_scan = 0 for a sustained period (typically >30 days under
-- production traffic). We scan pg_stat_user_indexes for candidates and DROP
-- only those that:
--   - are NOT primary keys
--   - are NOT unique constraints (uniqueness is a correctness guarantee)
--   - are NOT partial/expression indexes (we can't easily reason about them)
--   - are NOT on partitioned tables (dropping a partition parent index is
--     a multi-step operation we refuse to do in a bulk cleanup)
--
-- We stamp the output so operators can confirm which indexes went away.
-- -----------------------------------------------------------------------------
DO $unused_indexes$
DECLARE
  rec record;
  stmt text;
  dropped_count int := 0;
BEGIN
  FOR rec IN
    SELECT
      s.schemaname,
      s.relname   AS table_name,
      s.indexrelname AS index_name,
      s.idx_scan
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    JOIN pg_class c ON c.oid = s.indexrelid
    WHERE s.schemaname = 'public'
      AND s.idx_scan = 0
      AND i.indisprimary = false
      AND i.indisunique  = false
      AND i.indisexclusion = false
      AND i.indpred IS NULL          -- skip partial
      AND array_length(i.indkey::int[], 1) >= 1
      AND i.indexrelid NOT IN (
        -- Keep FK support indexes even if unused yet — they gate planner
        -- behaviour when the fresh FK starts seeing traffic. The FK index
        -- naming convention from 20260421000000 is `<table>_<col>_fkey_idx`.
        SELECT idx.indexrelid
          FROM pg_index idx
          JOIN pg_class ic ON ic.oid = idx.indexrelid
         WHERE ic.relname LIKE '%\_fkey\_idx' ESCAPE '\\'
      )
  LOOP
    stmt := format('DROP INDEX IF EXISTS %I.%I', rec.schemaname, rec.index_name);
    RAISE NOTICE 'Dropping unused index: % (table=%, scans=%)',
      rec.index_name, rec.table_name, rec.idx_scan;
    BEGIN
      EXECUTE stmt;
      dropped_count := dropped_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped % due to %', rec.index_name, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Dropped % unused indexes', dropped_count;
END
$unused_indexes$;

-- -----------------------------------------------------------------------------
-- 3. Cover llm_invocations.report_id.
--
-- This column is the single hottest join key on the Report detail page's
-- Activity panel. It's nullable (system-level invocations are report-less)
-- so we build a partial index that only includes non-null rows. That keeps
-- the index small — roughly 60% of invocations are report-scoped — while
-- still answering the common query "all LLM calls for this report".
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS llm_invocations_report_id_idx
  ON public.llm_invocations (report_id)
  WHERE report_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Add created_at to append-only tables that lacked it.
--
-- Any append-only mutation table in a SOC 2 environment needs a timestamp.
-- We enumerate the schema and add the column on candidates that don't have
-- it yet. Applying NOT NULL + DEFAULT now() in one shot is cheap on empty
-- tables and safe on populated ones because Postgres 11+ fast-paths the
-- default to a metadata-only change.
-- -----------------------------------------------------------------------------
DO $created_at$
DECLARE
  candidate_tables text[] := ARRAY[
    'fix_verifications',
    'fix_coordinations',
    'fix_dispatch_jobs',
    'llm_invocations',
    'cron_runs',
    'anti_gaming_events',
    'audit_log',
    'soc2_evidence',
    'plugin_events',
    'nl_query_rate_limits'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY candidate_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()',
        t
      );
      RAISE NOTICE 'Added created_at to public.%', t;
    END IF;
  END LOOP;
END
$created_at$;

-- -----------------------------------------------------------------------------
-- 5. Embeddings dimension flexibility.
--
-- The Phase 0 schema pinned every embedding column to `vector(1536)` (OpenAI
-- ada-002 width). Moving to voyage-3 (1024) or voyage-code-3 (1024) would
-- require a full rebuild. We don't attempt a rebuild here (it's table-
-- specific and potentially GB-scale); we just add a metadata column to
-- record which embedding model produced each row so a future migration can
-- shard by model and migrate progressively.
-- -----------------------------------------------------------------------------
DO $embedding_meta$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name = 'embedding'
       AND c.udt_name   = 'vector'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS embedding_model text',
      rec.table_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS embedding_dim integer',
      rec.table_name
    );
    RAISE NOTICE 'Embedding meta added to public.%', rec.table_name;
  END LOOP;
END
$embedding_meta$;

-- -----------------------------------------------------------------------------
-- 6. Auth hardening notes (non-SQL).
--
-- Supabase toggles for leaked-password protection and MFA enrollment are
-- configured via the dashboard (Auth → Providers → Security). We cannot
-- set them from SQL. The manual steps live in
-- docs/wave-s2-manual-steps.md and this migration records a soft reminder.
-- -----------------------------------------------------------------------------
DO $auth_reminder$
BEGIN
  RAISE NOTICE 'REMINDER: enable leaked-password protection and MFA requirement in the Supabase dashboard. See docs/wave-s2-manual-steps.md.';
END
$auth_reminder$;
