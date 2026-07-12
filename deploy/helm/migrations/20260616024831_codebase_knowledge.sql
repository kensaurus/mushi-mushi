-- Wiki / Karpathy-style knowledge sources + chunk embeddings for RAG merge.

CREATE TABLE IF NOT EXISTS public.project_codebase_wiki_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('repo_subpath', 'upload', 'url')),
  root_path    text NOT NULL,
  label        text,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_codebase_knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id    uuid NOT NULL REFERENCES public.project_codebase_wiki_sources(id) ON DELETE CASCADE,
  article_path text NOT NULL,
  chunk_index  int NOT NULL DEFAULT 0,
  title        text,
  body         text NOT NULL,
  embedding    vector(1536),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_knowledge_chunk UNIQUE (source_id, article_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project
  ON public.project_codebase_knowledge_chunks (project_id);

CREATE TABLE IF NOT EXISTS public.project_codebase_knowledge_graph (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id          uuid NOT NULL REFERENCES public.project_codebase_wiki_sources(id) ON DELETE CASCADE,
  index_fingerprint  text NOT NULL,
  graph              jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_knowledge_graph_source UNIQUE (source_id)
);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector,
  match_project uuid,
  match_count integer DEFAULT 5,
  source_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  article_path text,
  title text,
  body text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
    SELECT
      kc.id,
      kc.article_path,
      kc.title,
      kc.body,
      1 - (kc.embedding <=> query_embedding) AS similarity
    FROM project_codebase_knowledge_chunks kc
    WHERE kc.project_id = match_project
      AND kc.embedding IS NOT NULL
      AND (source_id IS NULL OR kc.source_id = source_id)
    ORDER BY kc.embedding <=> query_embedding
    LIMIT match_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, uuid, integer, uuid) TO anon, authenticated, service_role;

ALTER TABLE public.project_codebase_wiki_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_codebase_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_codebase_knowledge_graph ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_sources_member_select ON public.project_codebase_wiki_sources;
CREATE POLICY wiki_sources_member_select ON public.project_codebase_wiki_sources
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS knowledge_chunks_member_select ON public.project_codebase_knowledge_chunks;
CREATE POLICY knowledge_chunks_member_select ON public.project_codebase_knowledge_chunks
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS knowledge_graph_member_select ON public.project_codebase_knowledge_graph;
CREATE POLICY knowledge_graph_member_select ON public.project_codebase_knowledge_graph
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

NOTIFY pgrst, 'reload schema';
