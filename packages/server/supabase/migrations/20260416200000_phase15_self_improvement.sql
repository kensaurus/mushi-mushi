-- ---------------------------------------------------------------------------
-- Classification Evaluations (LLM-as-Judge)
-- ---------------------------------------------------------------------------
create table if not exists classification_evaluations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  judge_model text not null,
  judge_score float not null,
  accuracy_score float,
  severity_score float,
  component_score float,
  repro_score float,
  judge_reasoning text,
  classification_agreed boolean,
  suggested_correction jsonb,
  prompt_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_eval_project on classification_evaluations(project_id);
create index if not exists idx_eval_report on classification_evaluations(report_id);
create index if not exists idx_eval_created on classification_evaluations(project_id, created_at desc);

alter table classification_evaluations enable row level security;

-- ---------------------------------------------------------------------------
-- Prompt Versions (A/B Testing)
-- ---------------------------------------------------------------------------
create table if not exists prompt_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  stage text not null,
  version text not null,
  prompt_template text not null,
  is_active boolean default false,
  is_candidate boolean default false,
  traffic_percentage int default 0 check (traffic_percentage between 0 and 100),
  avg_judge_score float,
  total_evaluations int default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_prompt_project on prompt_versions(project_id, stage);

alter table prompt_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Reporter Reputation (Gamification)
-- ---------------------------------------------------------------------------
create table if not exists reporter_reputation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reporter_token_hash text not null,
  reputation_score float not null default 1.0,
  total_points int not null default 0,
  confirmed_bugs int not null default 0,
  dismissed_reports int not null default 0,
  total_reports int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, reporter_token_hash)
);

create index if not exists idx_rep_project on reporter_reputation(project_id);
create index if not exists idx_rep_token on reporter_reputation(reporter_token_hash);

alter table reporter_reputation enable row level security;

create trigger set_reporter_reputation_updated_at
  before update on reporter_reputation
  for each row execute function update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Reporter Devices (Anti-Gaming)
-- ---------------------------------------------------------------------------
create table if not exists reporter_devices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  device_fingerprint text not null,
  reporter_tokens text[],
  ip_addresses text[],
  first_seen timestamptz default now(),
  report_count int default 0,
  flagged_as_suspicious boolean default false,
  flag_reason text,
  unique(project_id, device_fingerprint)
);

create index if not exists idx_device_project on reporter_devices(project_id);

alter table reporter_devices enable row level security;

-- ---------------------------------------------------------------------------
-- Reporter Notifications
-- ---------------------------------------------------------------------------
create table if not exists reporter_notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  reporter_token_hash text not null,
  notification_type text not null,
  channel text not null default 'in_app',
  payload jsonb,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notif_reporter on reporter_notifications(reporter_token_hash, project_id);
create index if not exists idx_notif_report on reporter_notifications(report_id);

alter table reporter_notifications enable row level security;

-- ---------------------------------------------------------------------------
-- Extend reports table
-- ---------------------------------------------------------------------------
alter table reports add column if not exists vision_analysis jsonb;
alter table reports add column if not exists judge_score float;
alter table reports add column if not exists judge_model text;
alter table reports add column if not exists judge_evaluated_at timestamptz;
alter table reports add column if not exists prompt_version_id uuid references prompt_versions(id);

-- ---------------------------------------------------------------------------
-- Extend project_settings table
-- ---------------------------------------------------------------------------
alter table project_settings add column if not exists judge_model text default 'claude-opus-4-6';
alter table project_settings add column if not exists judge_enabled boolean default true;
alter table project_settings add column if not exists judge_sample_size int default 50;
alter table project_settings add column if not exists ab_test_traffic_pct int default 10;
alter table project_settings add column if not exists discord_webhook_url text;
alter table project_settings add column if not exists reporter_notifications_enabled boolean default true;
alter table project_settings add column if not exists enable_vision_analysis boolean default true;

-- ---------------------------------------------------------------------------
-- Drift detection helper: weekly average judge scores
-- ---------------------------------------------------------------------------
create or replace function weekly_judge_scores(p_project_id uuid, p_weeks int default 8)
returns table (
  week_start date,
  avg_score float,
  avg_accuracy float,
  avg_severity float,
  avg_component float,
  avg_repro float,
  eval_count bigint
) language sql stable as $$
  select
    date_trunc('week', ce.created_at)::date as week_start,
    avg(ce.judge_score)::float as avg_score,
    avg(ce.accuracy_score)::float as avg_accuracy,
    avg(ce.severity_score)::float as avg_severity,
    avg(ce.component_score)::float as avg_component,
    avg(ce.repro_score)::float as avg_repro,
    count(*) as eval_count
  from classification_evaluations ce
  where ce.project_id = p_project_id
    and ce.created_at >= now() - (p_weeks || ' weeks')::interval
  group by date_trunc('week', ce.created_at)
  order by week_start desc;
$$;
