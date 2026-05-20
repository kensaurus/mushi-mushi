-- Sentry MUSHI-MUSHI-SERVER-M (regressed 2026-05-20): PostgREST returned
-- PGRST202 for match_codebase_files when the schema cache was stale or the
-- caller sent the wrong RPC arg name (match_project_id vs match_project).
-- Re-declare the function (no logic change) and poke PostgREST to reload.

CREATE OR REPLACE FUNCTION public.match_codebase_files(
  query_embedding vector,
  match_project uuid,
  match_count integer DEFAULT 5
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
    ORDER BY pcf.embedding <=> query_embedding
    LIMIT match_count;
END;
$function$;

NOTIFY pgrst, 'reload schema';
