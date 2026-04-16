-- ---------------------------------------------------------------------------
-- Knowledge Graph: Nodes
-- ---------------------------------------------------------------------------
create table if not exists graph_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_type text not null,
  label text not null,
  metadata jsonb,
  last_traversed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_graph_nodes_project on graph_nodes(project_id, node_type);
create index if not exists idx_graph_nodes_label on graph_nodes(project_id, label);

alter table graph_nodes enable row level security;

-- ---------------------------------------------------------------------------
-- Knowledge Graph: Edges
-- ---------------------------------------------------------------------------
create table if not exists graph_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source_node_id uuid not null references graph_nodes(id) on delete cascade,
  target_node_id uuid not null references graph_nodes(id) on delete cascade,
  edge_type text not null,
  weight float default 1.0,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_graph_edges_source on graph_edges(source_node_id);
create index if not exists idx_graph_edges_target on graph_edges(target_node_id);
create index if not exists idx_graph_edges_project on graph_edges(project_id, edge_type);

alter table graph_edges enable row level security;

-- ---------------------------------------------------------------------------
-- Blast Radius Materialized View
-- ---------------------------------------------------------------------------
create unique index if not exists idx_graph_edges_pair
  on graph_edges(source_node_id, target_node_id, edge_type);

create materialized view if not exists blast_radius_cache as
with recursive blast as (
  select source_node_id, target_node_id, edge_type, 1 as depth
  from graph_edges
  where edge_type in ('causes', 'related_to', 'affects')
  union all
  select b.source_node_id, e.target_node_id, e.edge_type, b.depth + 1
  from blast b
  join graph_edges e on e.source_node_id = b.target_node_id
  where b.depth < 4
)
select distinct source_node_id, target_node_id, min(depth) as min_depth
from blast
group by source_node_id, target_node_id;

create unique index if not exists idx_blast_radius_pair
  on blast_radius_cache(source_node_id, target_node_id);

-- ---------------------------------------------------------------------------
-- Bug Ontology
-- ---------------------------------------------------------------------------
create table if not exists bug_ontology (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  tag text not null,
  parent_tag text,
  description text,
  usage_count int default 0,
  created_at timestamptz not null default now(),
  unique(project_id, tag)
);

create index if not exists idx_ontology_parent on bug_ontology(project_id, parent_tag);

alter table bug_ontology enable row level security;

-- Seed global ontology
insert into bug_ontology (project_id, tag, parent_tag, description) values
  (null, 'state-management', null, 'State management bugs'),
  (null, 'react-useState', 'state-management', 'React useState issues'),
  (null, 'react-useEffect', 'state-management', 'React useEffect issues'),
  (null, 'async-race-condition', 'state-management', 'Async race conditions'),
  (null, 'layout', null, 'Layout and CSS bugs'),
  (null, 'css-overflow', 'layout', 'CSS overflow issues'),
  (null, 'flexbox-alignment', 'layout', 'Flexbox alignment issues'),
  (null, 'responsive-breakpoint', 'layout', 'Responsive breakpoint issues'),
  (null, 'network', null, 'Network and API bugs'),
  (null, 'timeout', 'network', 'Network timeouts'),
  (null, 'cors', 'network', 'CORS issues'),
  (null, 'retry-exhaustion', 'network', 'Retry exhaustion'),
  (null, 'performance', null, 'Performance issues'),
  (null, 'memory-leak', 'performance', 'Memory leaks'),
  (null, 'render-loop', 'performance', 'Infinite re-render loops'),
  (null, 'bundle-size', 'performance', 'Bundle size issues')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Fix Verifications (Playwright)
-- ---------------------------------------------------------------------------
create table if not exists fix_verifications (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  fix_pr_url text,
  fix_commit_sha text,
  verification_status text not null,
  screenshot_before text,
  screenshot_after text,
  visual_diff_score float,
  interaction_results jsonb,
  error_message text,
  verified_at timestamptz not null default now()
);

create index if not exists idx_fix_verif_report on fix_verifications(report_id);

alter table fix_verifications enable row level security;

-- ---------------------------------------------------------------------------
-- Project Codebase Files (RAG)
-- ---------------------------------------------------------------------------
create table if not exists project_codebase_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_path text not null,
  content_hash text not null,
  content_preview text,
  last_modified timestamptz,
  component_tag text,
  embedding vector(1536),
  embedding_model text,
  indexed_at timestamptz default now(),
  unique(project_id, file_path)
);

create index if not exists idx_codebase_project on project_codebase_files(project_id);
create index if not exists idx_codebase_embedding on project_codebase_files
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

alter table project_codebase_files enable row level security;

-- ---------------------------------------------------------------------------
-- Codebase similarity search RPC
-- ---------------------------------------------------------------------------
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
) language plpgsql stable as $$
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

-- ---------------------------------------------------------------------------
-- Extend reports table
-- ---------------------------------------------------------------------------
alter table reports add column if not exists bug_ontology_tags text[];
alter table reports add column if not exists regressed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Extend project_settings table
-- ---------------------------------------------------------------------------
alter table project_settings add column if not exists codebase_index_enabled boolean default false;
alter table project_settings add column if not exists codebase_repo_url text;
alter table project_settings add column if not exists graph_edge_retention_days int default 180;

-- ---------------------------------------------------------------------------
-- Ontology usage counter
-- ---------------------------------------------------------------------------
create or replace function increment_ontology_usage(p_tag text, p_project_id uuid)
returns void language plpgsql as $$
begin
  update bug_ontology
  set usage_count = usage_count + 1
  where tag = p_tag and (project_id = p_project_id or project_id is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read-only query execution (for NL query endpoint)
-- ---------------------------------------------------------------------------
create or replace function execute_readonly_query(query_text text, project_id_param uuid)
returns jsonb language plpgsql security definer as $$
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

-- ---------------------------------------------------------------------------
-- Graph utility: get blast radius for a node
-- ---------------------------------------------------------------------------
create or replace function get_blast_radius(p_node_id uuid)
returns table (
  target_node_id uuid,
  node_type text,
  label text,
  min_depth int
) language sql stable as $$
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
