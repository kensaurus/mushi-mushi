-- Codebase Understand — chat threads, lazy summaries, guided tours, domain views.
-- Powers /explore Ask · Tour · Domains tabs and MCP ask_codebase tools.

-- ── Chat persistence ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.codebase_chat_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.codebase_chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES public.codebase_chat_threads(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  citations       jsonb,
  model           text,
  input_tokens    int,
  output_tokens   int,
  cost_usd        numeric(12, 6),
  latency_ms      int,
  langfuse_trace_id text,
  meta            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_codebase_chat_threads_project_user
  ON public.codebase_chat_threads (project_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_codebase_chat_messages_thread
  ON public.codebase_chat_messages (thread_id, created_at);

-- ── Lazy LLM summaries (per file or symbol) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_codebase_summaries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_path     text NOT NULL,
  symbol_name   text,
  summary       text NOT NULL,
  model         text,
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_codebase_summaries UNIQUE NULLS NOT DISTINCT (project_id, file_path, symbol_name)
);

CREATE INDEX IF NOT EXISTS idx_codebase_summaries_project_path
  ON public.project_codebase_summaries (project_id, file_path);

-- ── Cached guided tour + domain extraction ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_codebase_tours (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  index_fingerprint  text NOT NULL,
  stops              jsonb NOT NULL,
  model              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_codebase_tours_project UNIQUE (project_id)
);

CREATE TABLE IF NOT EXISTS public.project_codebase_domains (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  index_fingerprint  text NOT NULL,
  domains            jsonb NOT NULL,
  model              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_codebase_domains_project UNIQUE (project_id)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.codebase_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codebase_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_codebase_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_codebase_tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_codebase_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS codebase_chat_threads_member_select ON public.codebase_chat_threads;
CREATE POLICY codebase_chat_threads_member_select ON public.codebase_chat_threads
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS codebase_chat_threads_owner_insert ON public.codebase_chat_threads;
CREATE POLICY codebase_chat_threads_owner_insert ON public.codebase_chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (private.is_project_member(project_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS codebase_chat_threads_owner_update ON public.codebase_chat_threads;
CREATE POLICY codebase_chat_threads_owner_update ON public.codebase_chat_threads
  FOR UPDATE TO authenticated
  USING (private.is_project_member(project_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS codebase_chat_threads_owner_delete ON public.codebase_chat_threads;
CREATE POLICY codebase_chat_threads_owner_delete ON public.codebase_chat_threads
  FOR DELETE TO authenticated
  USING (private.is_project_member(project_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS codebase_chat_messages_member_select ON public.codebase_chat_messages;
CREATE POLICY codebase_chat_messages_member_select ON public.codebase_chat_messages
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS codebase_chat_messages_owner_insert ON public.codebase_chat_messages;
CREATE POLICY codebase_chat_messages_owner_insert ON public.codebase_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (private.is_project_member(project_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS codebase_summaries_member_select ON public.project_codebase_summaries;
CREATE POLICY codebase_summaries_member_select ON public.project_codebase_summaries
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS codebase_tours_member_select ON public.project_codebase_tours;
CREATE POLICY codebase_tours_member_select ON public.project_codebase_tours
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS codebase_domains_member_select ON public.project_codebase_domains;
CREATE POLICY codebase_domains_member_select ON public.project_codebase_domains
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

COMMENT ON TABLE public.codebase_chat_threads IS
  'Project-scoped codebase Q&A threads for /explore Ask tab.';
COMMENT ON TABLE public.project_codebase_summaries IS
  'Lazy LLM-generated plain-English summaries; invalidated via content_hash on re-index.';
COMMENT ON TABLE public.project_codebase_tours IS
  'Cached dependency-ordered guided tour stops for /explore Tour tab.';
COMMENT ON TABLE public.project_codebase_domains IS
  'Cached business-domain view (domains → flows → steps) for /explore Domains tab.';

NOTIFY pgrst, 'reload schema';
