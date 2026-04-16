-- Project Integrations (Jira, Linear, GitHub, PagerDuty)
create table if not exists project_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  integration_type text not null,
  config jsonb not null default '{}',
  is_active boolean default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, integration_type)
);

create index if not exists idx_integration_project on project_integrations(project_id);
alter table project_integrations enable row level security;

-- Plugin Registry
create table if not exists project_plugins (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  plugin_name text not null,
  plugin_version text not null,
  config jsonb,
  is_active boolean default true,
  execution_order int default 0,
  created_at timestamptz not null default now(),
  unique(project_id, plugin_name)
);

create index if not exists idx_plugin_project on project_plugins(project_id);
alter table project_plugins enable row level security;

-- Synthetic Reports
create table if not exists synthetic_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  generated_report jsonb not null,
  expected_classification jsonb not null,
  actual_classification jsonb,
  match_score float,
  generated_at timestamptz not null default now()
);

create index if not exists idx_synthetic_project on synthetic_reports(project_id);
alter table synthetic_reports enable row level security;

-- Extend project_settings
alter table project_settings add column if not exists integrations_config jsonb default '{}';
alter table project_settings add column if not exists intelligence_report_schedule text default 'weekly';
alter table project_settings add column if not exists intelligence_report_day int default 1;
alter table project_settings add column if not exists intelligence_report_timezone text default 'UTC';
alter table project_settings add column if not exists enable_synthetic_testing boolean default false;
alter table project_settings add column if not exists synthetic_batch_size int default 20;
