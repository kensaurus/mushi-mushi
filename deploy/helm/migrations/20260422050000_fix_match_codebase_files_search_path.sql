-- match_codebase_files was deployed with search_path = 'pg_catalog, public',
-- which makes the pgvector distance operator `<=>` unresolvable because the
-- operator lives in the `extensions` schema. That caused every RAG query to
-- raise "operator does not exist: extensions.vector <=> extensions.vector"
-- and kept the fix-worker in skipped_no_context even though glot.it had 308
-- fully-embedded files indexed.
--
-- Re-declare the function with `extensions` added to search_path. We keep
-- STABLE + SECURITY INVOKER semantics so RLS still applies.

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

-- Same class of bug in match_report_embeddings (search_path = 'public'),
-- which would break dedup/grouping once anyone tried to use it. Fix both
-- in the same migration to avoid a second foot-gun later.

CREATE OR REPLACE FUNCTION public.match_report_embeddings(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_project_id uuid
)
RETURNS TABLE(
  report_id uuid,
  similarity double precision,
  description text,
  category text,
  created_at timestamp with time zone,
  report_group_id uuid
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    re.report_id,
    1 - (re.embedding <=> query_embedding) AS similarity,
    r.description,
    r.category,
    r.created_at,
    r.report_group_id
  FROM report_embeddings re
  JOIN reports r ON r.id = re.report_id
  WHERE r.project_id = p_project_id
    AND re.model = 'text-embedding-3-small'
    AND 1 - (re.embedding <=> query_embedding) > match_threshold
  ORDER BY re.embedding <=> query_embedding
  LIMIT match_count;
$function$;
