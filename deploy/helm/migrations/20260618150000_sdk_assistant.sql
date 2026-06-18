/*
FILE: 20260618150000_sdk_assistant.sql
PURPOSE: Page-aware in-SDK assistant (Workstream E, v1 — knowledge-grounded,
         NO cross-user data so there is zero user-data leak surface).

CHANGES:
1. project_settings assistant config columns (console-driven, no rebuild):
   - assistant_enabled       bool   — master switch (default off)
   - assistant_label         text   — tab label (default "Ask")
   - assistant_greeting      text   — empty-thread greeting
   - assistant_suggestions   jsonb  — starter question chips (array of strings)
   - assistant_knowledge     text   — the app-knowledge corpus the LLM may cite
                                       (capped at 40k chars by the ingest route).
   These feed BOTH GET /v1/sdk/config (so the widget shows the tab) and
   POST /v1/sdk/assistant (so the LLM is grounded).

2. sdk_assistant_messages — per-turn log (BYOK LLM usage + cost + latency +
   the page route the question was asked from). Service-role only (the SDK
   writes through the edge function, never directly). This is the "logged"
   requirement: every assistant turn is auditable.

SECURITY:
- No pgvector / per-user RAG in v1 — the assistant answers ONLY from the
  page context the SDK publishes and the operator-authored knowledge corpus,
  so it structurally cannot leak another end-user's data, source code, or env.
- The system prompt (route side) hard-forbids revealing secrets/source.
*/

alter table project_settings
  add column if not exists assistant_enabled     boolean not null default false,
  add column if not exists assistant_label       text,
  add column if not exists assistant_greeting     text,
  add column if not exists assistant_suggestions jsonb,
  add column if not exists assistant_knowledge    text;

comment on column project_settings.assistant_enabled is
  'Master switch for the in-SDK page-aware assistant tab (Workstream E).';
comment on column project_settings.assistant_knowledge is
  'Operator-authored app-knowledge corpus the assistant may cite. Capped at 40k chars by the ingest route. Never contains secrets/source — scanned on write.';

create table if not exists sdk_assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  thread_id       uuid not null,
  -- The verified end-user (when the SDK sent a signed identity token) or null
  -- for anonymous reporters. Stored for audit/abuse triage only.
  end_user_id     uuid references end_users(id) on delete set null,
  reporter_token_hash text,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  route           text,
  model           text,
  fallback_used   boolean,
  input_tokens    integer,
  output_tokens   integer,
  cost_usd        numeric(12,6),
  latency_ms      integer,
  langfuse_trace_id text,
  meta            jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists sdk_assistant_messages_project_thread_idx
  on sdk_assistant_messages (project_id, thread_id, created_at);
create index if not exists sdk_assistant_messages_project_created_idx
  on sdk_assistant_messages (project_id, created_at desc);

alter table sdk_assistant_messages enable row level security;

-- Service-role only: the SDK never reads/writes this table directly; all
-- access flows through the edge function under the service key. An explicit
-- RESTRICTIVE deny-all keeps anon/authenticated locked out and silences the
-- "RLS enabled, no policy" advisor.
drop policy if exists sdk_assistant_messages_deny_all on sdk_assistant_messages;
create policy sdk_assistant_messages_deny_all
  on sdk_assistant_messages
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Defense-in-depth: revoke the default table grants so the table is not even
-- discoverable in the GraphQL/PostgREST schema for anon/authenticated. RLS
-- deny-all already blocks row access; this also clears the
-- `anon_table_exposed` advisor and protects the chat-log content if RLS were
-- ever toggled off. The edge function uses the service role, which bypasses
-- both RLS and these grants.
revoke all on sdk_assistant_messages from anon, authenticated;

notify pgrst, 'reload schema';
