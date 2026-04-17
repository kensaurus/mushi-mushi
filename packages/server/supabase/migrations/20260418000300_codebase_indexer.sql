-- M4 (Wave A v0.6.0): RAG codebase indexer schema
-- Adds symbol-aware columns to project_codebase_files so each row represents a
-- coherent code chunk (function, class, top-level block) rather than a whole
-- file. Tombstone-on-delete pattern enables incremental re-indexing without
-- losing referential history.

ALTER TABLE project_codebase_files
  ADD COLUMN IF NOT EXISTS symbol_name TEXT,
  ADD COLUMN IF NOT EXISTS signature TEXT,
  ADD COLUMN IF NOT EXISTS line_start INTEGER,
  ADD COLUMN IF NOT EXISTS line_end INTEGER,
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS tombstoned_at timestamptz;

-- The original (project_id, file_path) UNIQUE was implicit; with chunking we
-- need (project_id, file_path, symbol_name) to allow many chunks per file.
-- We keep the old constraint name available for migrations that have already
-- applied it; new constraint added with NULLS NOT DISTINCT so whole-file rows
-- (NULL symbol_name) still collide on (project_id, file_path).
--
-- NULLS NOT DISTINCT is required (rather than COALESCE in an expression index)
-- so that column-list `ON CONFLICT (project_id, file_path, symbol_name)`
-- inference matches this index — PostgREST's `on_conflict` parameter and the
-- Supabase JS client's `upsert({ onConflict })` only support plain column
-- names, not expressions. Requires PostgreSQL 15+.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_codebase_files_project_id_file_path_key'
  ) THEN
    ALTER TABLE project_codebase_files
      DROP CONSTRAINT project_codebase_files_project_id_file_path_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_codebase_chunks
  ON project_codebase_files (project_id, file_path, symbol_name) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_codebase_files_active
  ON project_codebase_files (project_id, file_path)
  WHERE tombstoned_at IS NULL;

COMMENT ON COLUMN project_codebase_files.symbol_name IS
  'V5.3 §2.3.4: Function or class name from tree-sitter chunking. Null = whole-file row.';
COMMENT ON COLUMN project_codebase_files.signature IS
  'V5.3 §2.3.4: First line of function/class signature for human-readable RAG context.';
COMMENT ON COLUMN project_codebase_files.tombstoned_at IS
  'V5.3 §2.3.4: Soft-delete timestamp for incremental re-indexing without referential loss.';

-- Update RPC to surface symbol-aware fields and exclude tombstoned rows.
CREATE OR REPLACE FUNCTION match_codebase_files(
  query_embedding vector(1536),
  match_project uuid,
  match_count int default 5
)
RETURNS TABLE (
  id uuid,
  file_path text,
  content_preview text,
  component_tag text,
  symbol_name text,
  signature text,
  line_start int,
  line_end int,
  similarity float
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT
      pcf.id,
      pcf.file_path,
      pcf.content_preview,
      pcf.component_tag,
      pcf.symbol_name,
      pcf.signature,
      pcf.line_start,
      pcf.line_end,
      1 - (pcf.embedding <=> query_embedding) AS similarity
    FROM project_codebase_files pcf
    WHERE pcf.project_id = match_project
      AND pcf.tombstoned_at IS NULL
      AND pcf.embedding IS NOT NULL
    ORDER BY pcf.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

