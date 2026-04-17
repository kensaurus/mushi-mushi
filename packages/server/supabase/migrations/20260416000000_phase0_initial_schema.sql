-- Enable required extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects enable row level security;

-- ---------------------------------------------------------------------------
-- Project API Keys
-- ---------------------------------------------------------------------------
create table if not exists project_api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  key_hash text not null,
  label text not null default 'default',
  scopes text[] not null default '{report:write}',
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table project_api_keys enable row level security;

create index if not exists idx_api_keys_project on project_api_keys(project_id);
create index if not exists idx_api_keys_hash on project_api_keys(key_hash) where is_active = true;

-- ---------------------------------------------------------------------------
-- Project Settings
-- ---------------------------------------------------------------------------
create table if not exists project_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  slack_webhook_url text,
  stage1_model text not null default 'claude-sonnet-4-6',
  auto_classify boolean not null default true,
  max_reports_per_hour integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table project_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  category text not null check (category in ('bug', 'slow', 'visual', 'confusing', 'other')),
  user_category text,
  description text not null,
  user_intent text,

  environment jsonb not null default '{}',
  console_logs jsonb,
  network_logs jsonb,
  performance_metrics jsonb,
  screenshot_url text,
  screenshot_path text,
  selected_element jsonb,
  custom_metadata jsonb,

  session_id text,
  reporter_token_hash text not null,
  reporter_user_id text,
  app_version text,
  proactive_trigger text,

  status text not null default 'new' check (
    status in ('new', 'pending', 'submitted', 'queued', 'classified', 'grouped', 'fixing', 'fixed', 'dismissed')
  ),

  classification jsonb,
  classification_confidence real,
  confidence real,
  severity text check (severity is null or severity in ('critical', 'high', 'medium', 'low')),
  summary text,
  component text,
  classified_at timestamptz,

  queued_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table reports enable row level security;

create index if not exists idx_reports_project on reports(project_id);
create index if not exists idx_reports_status on reports(project_id, status);
create index if not exists idx_reports_created on reports(project_id, created_at desc);
create index if not exists idx_reports_reporter on reports(reporter_token_hash);
create index if not exists idx_reports_session on reports(session_id) where session_id is not null;

-- ---------------------------------------------------------------------------
-- Storage bucket for screenshots
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenshots',
  'screenshots',
  false,
  5242880,  -- 5MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Updated-at trigger function
-- ---------------------------------------------------------------------------
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_projects_updated_at
  before update on projects
  for each row execute function update_updated_at_column();

create trigger set_project_settings_updated_at
  before update on project_settings
  for each row execute function update_updated_at_column();

create trigger set_reports_updated_at
  before update on reports
  for each row execute function update_updated_at_column();
