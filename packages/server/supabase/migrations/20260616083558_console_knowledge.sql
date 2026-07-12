/*
FILE: 20260616180000_console_knowledge.sql
PURPOSE: Global console help knowledge index for the NL assistant (Cmd+K / Ask Mushi).

OVERVIEW:
- console_knowledge_chunks — doc-shaped chunks with pgvector embeddings (1536d).
- match_console_knowledge_chunks — semantic retrieval RPC (no project_id; global corpus).
- RLS: authenticated users can SELECT; writes are service-role only.

NOTES:
- Parallel to per-project project_codebase_knowledge_chunks (which is a scaffold).
- Populated by the console-knowledge-build edge function + scripts/build-console-knowledge.mjs.
*/

CREATE TABLE IF NOT EXISTS public.console_knowledge_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_path      text NOT NULL,
  section       text NOT NULL DEFAULT 'main',
  title         text,
  body          text NOT NULL,
  route_path    text,
  kind          text NOT NULL DEFAULT 'page'
    CHECK (kind IN ('page', 'recipe', 'howto', 'nav')),
  content_hash  text NOT NULL,
  embedding     vector(1536),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_console_knowledge_chunk UNIQUE (doc_path, section)
);

CREATE INDEX IF NOT EXISTS idx_console_knowledge_route
  ON public.console_knowledge_chunks (route_path)
  WHERE route_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_console_knowledge_embedding
  ON public.console_knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION public.match_console_knowledge_chunks(
  query_embedding vector,
  match_count integer DEFAULT 8
)
RETURNS TABLE(
  id uuid,
  doc_path text,
  route_path text,
  title text,
  body text,
  kind text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
    SELECT
      ck.id,
      ck.doc_path,
      ck.route_path,
      ck.title,
      ck.body,
      ck.kind,
      1 - (ck.embedding <=> query_embedding) AS similarity
    FROM public.console_knowledge_chunks ck
    WHERE ck.embedding IS NOT NULL
    ORDER BY ck.embedding <=> query_embedding
    LIMIT match_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_console_knowledge_chunks(vector, integer)
  TO authenticated, service_role;

ALTER TABLE public.console_knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS console_knowledge_authenticated_select ON public.console_knowledge_chunks;
CREATE POLICY console_knowledge_authenticated_select ON public.console_knowledge_chunks
  FOR SELECT TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
