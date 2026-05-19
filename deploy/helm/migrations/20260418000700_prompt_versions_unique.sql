-- Migration: 20260418000700_prompt_versions_unique
-- Purpose:   V5.3 §2.7 (M-cross-cutting) — enforce that (project_id, stage, version)
--            uniquely identifies a prompt row. Without this, two projects sharing
--            a version string like "v1" would have their judge averages cross-
--            contaminated by recordPromptResult.
--
-- Strategy:  COALESCE-on-NULL trick lets us treat the "global default" rows
--            (project_id IS NULL) as a single namespace while still allowing
--            per-project rows to coexist with the same version label.

DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT COALESCE(project_id::text, 'global'), stage, version, COUNT(*) c
      FROM prompt_versions
     GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % duplicate (project_id, stage, version) groups in prompt_versions; keeping the row with the most evaluations and deleting the rest.', dup_count;
    -- Keep the row with the highest total_evaluations (or latest created_at as tiebreaker).
    DELETE FROM prompt_versions p
    USING (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(project_id::text, 'global'), stage, version
               ORDER BY total_evaluations DESC NULLS LAST, created_at DESC
             ) AS rn
        FROM prompt_versions
    ) ranked
    WHERE p.id = ranked.id AND ranked.rn > 1;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_versions_scope
  ON prompt_versions ((COALESCE(project_id::text, 'global')), stage, version);

COMMENT ON INDEX uq_prompt_versions_scope IS
  'V5.3 §2.7: prevents recordPromptResult from corrupting running averages when two projects share a version label.';
