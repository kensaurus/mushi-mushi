-- ---------------------------------------------------------------------------
-- Ensure trigger function exists (may already exist from Phase 0)
-- ---------------------------------------------------------------------------
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- pgvector
-- ---------------------------------------------------------------------------
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Report Embeddings
-- ---------------------------------------------------------------------------
create table if not exists report_embeddings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  model text not null,
  dimensions int not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique(report_id, model)
);

alter table report_embeddings enable row level security;

create index if not exists idx_embeddings_default
  on report_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where model = 'text-embedding-3-small';

-- ---------------------------------------------------------------------------
-- Report Groups (semantic dedup)
-- ---------------------------------------------------------------------------
create table if not exists report_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  canonical_report_id uuid references reports(id),
  title text,
  status text not null default 'open',
  report_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table report_groups enable row level security;

create index if not exists idx_report_groups_project on report_groups(project_id, status);

create trigger set_report_groups_updated_at
  before update on report_groups
  for each row execute function update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Processing Queue (DLQ + Circuit Breaker)
-- ---------------------------------------------------------------------------
create table if not exists processing_queue (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  project_id uuid not null references projects(id),
  stage text not null default 'stage1',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table processing_queue enable row level security;

create index if not exists idx_queue_status on processing_queue(status, scheduled_at);
create index if not exists idx_queue_report on processing_queue(report_id);

-- ---------------------------------------------------------------------------
-- Reports — new columns
-- ---------------------------------------------------------------------------
alter table reports add column if not exists extracted_symptoms jsonb;
alter table reports add column if not exists stage1_classification jsonb;
alter table reports add column if not exists stage1_model text;
alter table reports add column if not exists stage1_prompt_version text;
alter table reports add column if not exists stage1_latency_ms int;
alter table reports add column if not exists stage2_analysis jsonb;
alter table reports add column if not exists stage2_model text;
alter table reports add column if not exists stage2_latency_ms int;
alter table reports add column if not exists reproduction_steps jsonb;
alter table reports add column if not exists report_group_id uuid references report_groups(id);
alter table reports add column if not exists sentry_seer_analysis jsonb;
alter table reports add column if not exists sentry_issue_url text;
alter table reports add column if not exists processing_attempts int default 0;

create index if not exists idx_reports_group on reports(report_group_id) where report_group_id is not null;

-- ---------------------------------------------------------------------------
-- Project Settings — new columns
-- ---------------------------------------------------------------------------
alter table project_settings add column if not exists stage2_model text default 'claude-sonnet-4-6';
alter table project_settings add column if not exists stage1_confidence_threshold float default 0.85;
alter table project_settings add column if not exists embedding_model text default 'text-embedding-3-small';
alter table project_settings add column if not exists dedup_threshold float default 0.82;
alter table project_settings add column if not exists sentry_dsn text;
alter table project_settings add column if not exists sentry_webhook_secret text;
alter table project_settings add column if not exists sentry_consume_user_feedback boolean default true;
