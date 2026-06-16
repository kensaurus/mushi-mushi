-- Scoped subdirectory indexing + optional path filter on semantic search.

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS codebase_index_scope_paths text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS codebase_index_exclude_globs text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS codebase_output_language text DEFAULT 'en';

COMMENT ON COLUMN public.project_settings.codebase_index_scope_paths IS
  'When set, only files under these path prefixes are indexed and queried. NULL = whole repo.';
COMMENT ON COLUMN public.project_settings.codebase_index_exclude_globs IS
  'Glob patterns excluded from index/RAG (e.g. **/generated/**).';
COMMENT ON COLUMN public.project_settings.codebase_output_language IS
  'Preferred language for LLM-generated tour/domain/summary/chat output (en default).';

-- Extend match_codebase_files with optional path prefix filter (backward compatible overload).
CREATE OR REPLACE FUNCTION public.match_codebase_files(
  query_embedding vector,
  match_project uuid,
  match_count integer DEFAULT 5,
  path_prefix text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  file_path text,
  content_preview text,
  component_tag text,
  symbol_name text,
  signature text,
  line_start integer,
  line_end integer,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
      AND (
        path_prefix IS NULL
        OR pcf.file_path = path_prefix
        OR pcf.file_path LIKE path_prefix || '/%'
      )
    ORDER BY pcf.embedding <=> query_embedding
    LIMIT match_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_codebase_files(vector, uuid, integer, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
