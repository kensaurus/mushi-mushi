-- Migration: 20260424030000_ask_mushi_messages
-- Purpose:   Persist every Ask Mushi (formerly "AI sidebar") message —
--            user prompts and assistant replies — so the sidebar can show
--            real history per page/project, restore conversations across
--            reloads, and prove LLM cost per turn from the same row that
--            powers the Health page (matches `llm_invocations.cost_usd`).
--
--            Hybrid model: rows are flat + tagged with `route`,
--            `project_id`, `selection_*`. A continuous chat session
--            shares a `thread_id` so reading by `(user_id, thread_id)`
--            reconstructs one conversation, but threads are NOT a
--            first-class table — the sidebar's "history" view simply
--            groups rows by `thread_id` on read.
--
--            Modelled after `nl_query_history` (20260418002100): single
--            user-scoped read policy, service_role does writes, indexes
--            on the two access patterns the UI uses.

CREATE TABLE IF NOT EXISTS ask_mushi_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Conversation grouping. Generated client-side (uuid) and reused for
  -- every turn in the same session. No FK — threads are derived, not stored.
  thread_id       uuid NOT NULL,
  -- Owning user. CASCADE so account deletion wipes their chat history;
  -- service_role bypasses RLS for inserts.
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Active project at send time, when knowable. Nullable because the
  -- assist endpoint also runs for users with no project yet (onboarding).
  project_id     uuid REFERENCES projects(id) ON DELETE CASCADE,
  -- Page context snapshot at send time. Stored verbatim so a later reload
  -- of the thread shows what the assistant *actually* saw, even if the
  -- user has since navigated away or changed filters.
  route           text NOT NULL,
  page_title      text,
  selection_kind  text,
  selection_id    text,
  selection_label text,
  filters         jsonb,
  -- Message body.
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  -- LLM telemetry — populated only for assistant rows. Mirrors the columns
  -- in `llm_invocations` so a join (or visual reconciliation against the
  -- Health page) is straightforward.
  model               text,
  fallback_used       boolean,
  input_tokens        int,
  output_tokens       int,
  cache_read_tokens   int,
  cache_create_tokens int,
  cost_usd            numeric(12,6),
  latency_ms          int,
  langfuse_trace_id   text,
  -- Structured payload (clarify chips, citations, slash-command intent,
  -- resolved @ mentions). Kept open-shape so the UI can evolve without
  -- migrations every time a new chip type lands.
  meta            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Two read paths:
--  1. Hydrate one thread → ORDER BY created_at within (user_id, thread_id)
--  2. History sidebar    → group by thread_id within (user_id, route)
CREATE INDEX IF NOT EXISTS idx_ask_mushi_user_thread
  ON ask_mushi_messages (user_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ask_mushi_user_route
  ON ask_mushi_messages (user_id, route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ask_mushi_project_route
  ON ask_mushi_messages (project_id, route, created_at DESC);

ALTER TABLE ask_mushi_messages ENABLE ROW LEVEL SECURITY;

-- Owner-only read. Threads are private to the user that created them —
-- there is no concept of sharing a chat across project members in v1.
DROP POLICY IF EXISTS ask_mushi_owner_read ON ask_mushi_messages;
CREATE POLICY ask_mushi_owner_read
  ON ask_mushi_messages
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Owner-only delete. Lets a user purge a thread without admin help, which
-- doubles as the documented PII control for messages that may have echoed
-- a user-typed report description.
DROP POLICY IF EXISTS ask_mushi_owner_delete ON ask_mushi_messages;
CREATE POLICY ask_mushi_owner_delete
  ON ask_mushi_messages
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE ask_mushi_messages IS
  'Ask Mushi (Cmd/Ctrl+J) chat history. Flat append-only log, grouped by thread_id. Mirrors llm_invocations.cost_usd for per-message billing reconciliation.';
