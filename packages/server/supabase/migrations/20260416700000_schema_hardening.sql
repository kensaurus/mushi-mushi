-- Schema hardening: timestamps, indexes, FK behaviors, function search_path, security

-- =========================================================================
-- 1. Secure trigger functions (set immutable search_path)
-- =========================================================================

create or replace function update_updated_at_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- 2. Secure all RPCs (set explicit search_path)
-- =========================================================================

create or replace function match_report_embeddings(
  query_embedding vector,
  match_threshold float,
  match_count int,
  p_project_id uuid
)
returns table (
  report_id uuid,
  similarity float,
  description text,
  category text,
  created_at timestamptz,
  report_group_id uuid
)
language sql stable
set search_path = 'public'
as $$
  select
    re.report_id,
    1 - (re.embedding <=> query_embedding) as similarity,
    r.description,
    r.category,
    r.created_at,
    r.report_group_id
  from report_embeddings re
  join reports r on r.id = re.report_id
  where r.project_id = p_project_id
    and re.model = 'text-embedding-3-small'
    and 1 - (re.embedding <=> query_embedding) > match_threshold
  order by re.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function weekly_judge_scores(p_project_id uuid, p_weeks int default 8)
returns table (
  week_start date,
  avg_score float,
  avg_accuracy float,
  avg_severity float,
  avg_component float,
  avg_repro float,
  eval_count bigint
)
language sql stable
set search_path = 'public'
as $$
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

create or replace function match_codebase_files(
  query_embedding vector(1536),
  match_project uuid,
  match_count int default 5
)
returns table (
  id uuid,
  file_path text,
  content_preview text,
  component_tag text,
  similarity float
)
language plpgsql stable
set search_path = 'public'
as $$
begin
  return query
    select
      pcf.id,
      pcf.file_path,
      pcf.content_preview,
      pcf.component_tag,
      1 - (pcf.embedding <=> query_embedding) as similarity
    from project_codebase_files pcf
    where pcf.project_id = match_project
      and pcf.embedding is not null
    order by pcf.embedding <=> query_embedding
    limit match_count;
end;
$$;

create or replace function increment_ontology_usage(p_tag text, p_project_id uuid)
returns void
language plpgsql
set search_path = 'public'
as $$
begin
  update bug_ontology
  set usage_count = usage_count + 1
  where tag = p_tag and (project_id = p_project_id or project_id is null);
end;
$$;

create or replace function execute_readonly_query(query_text text, project_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result jsonb;
begin
  if query_text ~* '\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b' then
    raise exception 'Only SELECT queries are allowed';
  end if;

  execute format('select jsonb_agg(row_to_json(t)) from (%s) t', query_text)
    using project_id_param
    into result;

  return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function get_blast_radius(p_node_id uuid)
returns table (
  target_node_id uuid,
  node_type text,
  label text,
  min_depth int
)
language sql stable
set search_path = 'public'
as $$
  select
    br.target_node_id,
    gn.node_type,
    gn.label,
    br.min_depth
  from blast_radius_cache br
  join graph_nodes gn on gn.id = br.target_node_id
  where br.source_node_id = p_node_id
  order by br.min_depth;
$$;

-- =========================================================================
-- 3. Add missing created_at columns (5 tables)
-- =========================================================================

alter table fix_attempts
  add column if not exists created_at timestamptz not null default now();

alter table fix_verifications
  add column if not exists created_at timestamptz not null default now();

alter table project_codebase_files
  add column if not exists created_at timestamptz not null default now();

alter table reporter_devices
  add column if not exists created_at timestamptz not null default now();

alter table synthetic_reports
  add column if not exists created_at timestamptz not null default now();

-- =========================================================================
-- 4. Add missing updated_at columns + triggers
--    (audit_logs excluded: immutable by design)
-- =========================================================================

-- bug_ontology
alter table bug_ontology
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_bug_ontology_updated_at
  before update on bug_ontology
  for each row execute function update_updated_at_column();

-- classification_evaluations
alter table classification_evaluations
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_classification_evaluations_updated_at
  before update on classification_evaluations
  for each row execute function update_updated_at_column();

-- enterprise_sso_configs
alter table enterprise_sso_configs
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_enterprise_sso_configs_updated_at
  before update on enterprise_sso_configs
  for each row execute function update_updated_at_column();

-- fine_tuning_jobs
alter table fine_tuning_jobs
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_fine_tuning_jobs_updated_at
  before update on fine_tuning_jobs
  for each row execute function update_updated_at_column();

-- fix_attempts
alter table fix_attempts
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_fix_attempts_updated_at
  before update on fix_attempts
  for each row execute function update_updated_at_column();

-- fix_verifications
alter table fix_verifications
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_fix_verifications_updated_at
  before update on fix_verifications
  for each row execute function update_updated_at_column();

-- graph_edges
alter table graph_edges
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_graph_edges_updated_at
  before update on graph_edges
  for each row execute function update_updated_at_column();

-- graph_nodes
alter table graph_nodes
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_graph_nodes_updated_at
  before update on graph_nodes
  for each row execute function update_updated_at_column();

-- processing_queue
alter table processing_queue
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_processing_queue_updated_at
  before update on processing_queue
  for each row execute function update_updated_at_column();

-- project_api_keys
alter table project_api_keys
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_project_api_keys_updated_at
  before update on project_api_keys
  for each row execute function update_updated_at_column();

-- project_codebase_files
alter table project_codebase_files
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_project_codebase_files_updated_at
  before update on project_codebase_files
  for each row execute function update_updated_at_column();

-- project_integrations
alter table project_integrations
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_project_integrations_updated_at
  before update on project_integrations
  for each row execute function update_updated_at_column();

-- project_plugins
alter table project_plugins
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_project_plugins_updated_at
  before update on project_plugins
  for each row execute function update_updated_at_column();

-- prompt_versions
alter table prompt_versions
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_prompt_versions_updated_at
  before update on prompt_versions
  for each row execute function update_updated_at_column();

-- report_embeddings
alter table report_embeddings
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_report_embeddings_updated_at
  before update on report_embeddings
  for each row execute function update_updated_at_column();

-- reporter_devices
alter table reporter_devices
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_reporter_devices_updated_at
  before update on reporter_devices
  for each row execute function update_updated_at_column();

-- reporter_notifications
alter table reporter_notifications
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_reporter_notifications_updated_at
  before update on reporter_notifications
  for each row execute function update_updated_at_column();

-- synthetic_reports
alter table synthetic_reports
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_synthetic_reports_updated_at
  before update on synthetic_reports
  for each row execute function update_updated_at_column();

-- audit_logs: intentionally excluded (immutable append-only records)

-- =========================================================================
-- 5. Add missing FK indexes (5 columns flagged by Supabase advisor)
-- =========================================================================

create index if not exists idx_queue_project
  on processing_queue(project_id);

create index if not exists idx_report_groups_canonical
  on report_groups(canonical_report_id);

create index if not exists idx_notif_project
  on reporter_notifications(project_id);

create index if not exists idx_reports_prompt_version
  on reports(prompt_version_id)
  where prompt_version_id is not null;

-- =========================================================================
-- 6. Fix FK ON DELETE behaviors (drop + recreate constraints)
-- =========================================================================

-- processing_queue.project_id: NO ACTION -> CASCADE
alter table processing_queue
  drop constraint if exists processing_queue_project_id_fkey;
alter table processing_queue
  add constraint processing_queue_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;

-- report_groups.canonical_report_id: NO ACTION -> SET NULL
alter table report_groups
  drop constraint if exists report_groups_canonical_report_id_fkey;
alter table report_groups
  add constraint report_groups_canonical_report_id_fkey
  foreign key (canonical_report_id) references reports(id) on delete set null;

-- reports.prompt_version_id: NO ACTION -> SET NULL
alter table reports
  drop constraint if exists reports_prompt_version_id_fkey;
alter table reports
  add constraint reports_prompt_version_id_fkey
  foreign key (prompt_version_id) references prompt_versions(id) on delete set null;

-- reports.report_group_id: NO ACTION -> SET NULL
alter table reports
  drop constraint if exists reports_report_group_id_fkey;
alter table reports
  add constraint reports_report_group_id_fkey
  foreign key (report_group_id) references report_groups(id) on delete set null;

-- =========================================================================
-- 7. Add missing boolean defaults
-- =========================================================================

alter table classification_evaluations
  alter column classification_agreed set default false;

alter table fix_attempts
  alter column review_passed set default false;

-- =========================================================================
-- 8. Security: revoke blast_radius_cache from public API roles
-- =========================================================================

revoke select on blast_radius_cache from anon, authenticated;

-- =========================================================================
-- 9. Note on vector extension
--    The vector extension is in the public schema. Moving it to the
--    extensions schema would require recreating all vector columns and
--    indexes. Documented as a known advisory; safe to address in a
--    future major version migration.
-- =========================================================================
