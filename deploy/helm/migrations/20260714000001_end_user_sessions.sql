-- SDK session tracking tables
-- Records lightweight session lifecycle events from the SDK (session_start,
-- heartbeat, page_view, session_end). Used to power per-project activity
-- dashboards in the console.

create table if not exists end_user_sessions (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  session_id          text not null,
  end_user_id         uuid references end_users(id) on delete set null,
  reporter_token_hash text,
  user_agent          text,
  entry_route         text,
  page_view_count     integer not null default 1,
  started_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  ended_at            timestamptz,
  created_at          timestamptz not null default now()
);

create unique index if not exists end_user_sessions_project_session_key
  on end_user_sessions (project_id, session_id);

create index if not exists end_user_sessions_project_started
  on end_user_sessions (project_id, started_at desc);

create index if not exists end_user_sessions_project_end_user
  on end_user_sessions (project_id, end_user_id)
  where end_user_id is not null;

create table if not exists session_page_views (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  session_id  text not null,
  route       text not null,
  ts          timestamptz not null default now()
);

create index if not exists session_page_views_project_ts
  on session_page_views (project_id, ts desc);

create index if not exists session_page_views_session
  on session_page_views (session_id, ts desc);

alter table end_user_sessions enable row level security;
alter table session_page_views enable row level security;

create policy "owner read end_user_sessions"
  on end_user_sessions for select
  using (
    project_id in (
      select p.id from projects p
      join organization_members om on om.organization_id = p.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "owner read session_page_views"
  on session_page_views for select
  using (
    project_id in (
      select p.id from projects p
      join organization_members om on om.organization_id = p.organization_id
      where om.user_id = auth.uid()
    )
  );
