-- Enterprise SSO Configs
create table if not exists enterprise_sso_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  provider_type text not null,
  provider_name text not null,
  metadata_url text,
  entity_id text,
  acs_url text,
  slo_url text,
  is_active boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_sso_project on enterprise_sso_configs(project_id);
alter table enterprise_sso_configs enable row level security;

-- Audit Logs
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid not null,
  actor_email text,
  actor_type text not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_project on audit_logs(project_id, created_at desc);
create index if not exists idx_audit_actor on audit_logs(actor_id, created_at desc);
alter table audit_logs enable row level security;

-- Fine-Tuning Jobs
create table if not exists fine_tuning_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  base_model text not null,
  training_data_url text,
  training_samples int,
  status text not null default 'pending',
  fine_tuned_model_id text,
  metrics jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_finetune_project on fine_tuning_jobs(project_id);
alter table fine_tuning_jobs enable row level security;

-- Extend projects
alter table projects add column if not exists data_region text default 'us-east-1';
alter table projects add column if not exists plan_tier text default 'free';

-- Extend project_settings
alter table project_settings add column if not exists data_retention_days int default 365;
alter table project_settings add column if not exists sso_enabled boolean default false;
alter table project_settings add column if not exists sso_provider text;
alter table project_settings add column if not exists fine_tuned_stage1_model text;
alter table project_settings add column if not exists fine_tuned_stage2_model text;
