-- =============================================================================
-- Phase 1a: Mistake Clusters + Lessons (closed-loop evolution)
-- Migration: 20260520000000_mistake_clusters.sql
--
-- Introduces:
--   mistake_clusters        — vector-centroided groups of similar reports
--   report_cluster_membership — many-to-one join (report → cluster + distance)
--   lessons                 — promoted clusters with rule text and embeddings
-- + match_lessons() RPC     — mirrors match_report_embeddings shape
-- + agent_personas          — extensible critic persona rows for PDCA (Phase 3)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. mistake_clusters
-- ─────────────────────────────────────────────────────────────────────────────
create type if not exists mistake_cluster_status as enum (
  'candidate',   -- not yet coherent or large enough for promotion
  'promoted',    -- ≥ 3 reports, coherence ≥ 0.75, lesson row created
  'retired'      -- superseded by a newer cluster or manually archived
);

create table if not exists mistake_clusters (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references projects(id) on delete cascade,
  centroid               vector(1536) not null,            -- running mean centroid
  cluster_size           integer not null default 1,
  severity_distribution  jsonb not null default '{}',      -- {"critical":2,"major":1}
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  status                 mistake_cluster_status not null default 'candidate',
  name                   text,                             -- LLM-generated short name
  summary                text,                             -- LLM-generated paragraph
  suggested_rule         text,                             -- 2-line one-shot rule
  judge_coherence_score  float check (judge_coherence_score between 0 and 1),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- HNSW index for fast centroid nearest-neighbor search
create index if not exists idx_mistake_clusters_centroid
  on mistake_clusters
  using hnsw (centroid vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_mistake_clusters_project_status
  on mistake_clusters (project_id, status);

alter table mistake_clusters enable row level security;

-- Service role can do anything (clusterer runs as service role)
create policy "service_role_all_mistake_clusters"
  on mistake_clusters for all
  using (true)
  with check (true);

-- Org members with read can see clusters for their projects
create policy "org_members_read_mistake_clusters"
  on mistake_clusters for select
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id
         and om.user_id = (select auth.uid())
    )
  );

create trigger trg_mistake_clusters_updated_at
  before update on mistake_clusters
  for each row execute function private.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. report_cluster_membership
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists report_cluster_membership (
  report_id    uuid not null references reports(id) on delete cascade,
  cluster_id   uuid not null references mistake_clusters(id) on delete cascade,
  distance     float not null check (distance >= 0 and distance <= 2),  -- cosine distance
  assigned_at  timestamptz not null default now(),
  primary key (report_id, cluster_id)
);

create index if not exists idx_rcm_cluster on report_cluster_membership (cluster_id);
create index if not exists idx_rcm_report  on report_cluster_membership (report_id);

alter table report_cluster_membership enable row level security;

create policy "service_role_all_rcm"
  on report_cluster_membership for all
  using (true) with check (true);

create policy "org_members_read_rcm"
  on report_cluster_membership for select
  using (
    exists (
      select 1 from mistake_clusters mc
        join projects p on p.id = mc.project_id
        join organization_members om on om.organization_id = p.organization_id
       where mc.id = cluster_id
         and om.user_id = (select auth.uid())
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. lessons
-- ─────────────────────────────────────────────────────────────────────────────
create type if not exists lesson_severity as enum (
  'info', 'warn', 'critical'
);

create table if not exists lessons (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  cluster_id          uuid references mistake_clusters(id) on delete set null,
  rule_text           text not null,         -- 2-line one-shot for PR injection
  anti_pattern        text,                  -- what the bad pattern looks like
  summary_paragraph   text,                  -- paragraph for lessons.json
  full_essay          text,                  -- full prose for the console lesson page
  severity            lesson_severity not null default 'warn',
  embedding           vector(1536),          -- embedded rule_text for retrieval
  frequency           integer not null default 1, -- how many times this lesson was reinforced
  last_reinforced_at  timestamptz not null default now(),
  promoted_at         timestamptz not null default now(),
  retired_at          timestamptz,
  sample_report_ids   uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- HNSW index for fast lesson retrieval in match_lessons()
create index if not exists idx_lessons_embedding
  on lessons
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_lessons_project_severity
  on lessons (project_id, severity);

create index if not exists idx_lessons_project_retired
  on lessons (project_id, retired_at)
  where retired_at is null;

alter table lessons enable row level security;

create policy "service_role_all_lessons"
  on lessons for all
  using (true) with check (true);

create policy "org_members_read_lessons"
  on lessons for select
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id
         and om.user_id = (select auth.uid())
    )
  );

create trigger trg_lessons_updated_at
  before update on lessons
  for each row execute function private.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. match_lessons RPC — mirrors match_report_embeddings shape
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function match_lessons(
  query_embedding  vector(1536),
  match_threshold  float default 0.70,
  match_count      int   default 50,
  p_project_id     uuid  default null
)
returns table (
  id                 uuid,
  rule_text          text,
  anti_pattern       text,
  summary_paragraph  text,
  severity           lesson_severity,
  frequency          integer,
  last_reinforced_at timestamptz,
  cluster_id         uuid,
  similarity         float
)
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select
    l.id,
    l.rule_text,
    l.anti_pattern,
    l.summary_paragraph,
    l.severity,
    l.frequency,
    l.last_reinforced_at,
    l.cluster_id,
    1 - (l.embedding <=> query_embedding) as similarity
  from lessons l
  where l.retired_at is null
    and l.embedding is not null
    and (p_project_id is null or l.project_id = p_project_id)
    and 1 - (l.embedding <=> query_embedding) > match_threshold
  order by l.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_lessons(vector, float, int, uuid)
  to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. agent_personas (Phase 3 PDCA — extensible critic personas)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists agent_personas (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  display_name text not null,
  prompt      text not null,    -- system prompt injected into the critic model
  rubric      jsonb not null default '{}', -- structured rubric definition
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table agent_personas enable row level security;

create policy "service_role_all_personas"
  on agent_personas for all using (true) with check (true);

create policy "authenticated_read_personas"
  on agent_personas for select using ((select auth.uid()) is not null);

-- Seed the canonical personas
insert into agent_personas (slug, display_name, prompt, rubric) values
(
  'tufte-data-density',
  'Tufte — Data Density',
  'You are Edward Tufte reviewing a UI. Evaluate every pixel for data-ink ratio. Flag chart junk, redundant labels, and decoration that carries no information. Demand the highest density of information per unit of display area.',
  '{"dimensions":["data_ink_ratio","redundancy","chart_junk","labeling_clarity"],"max_score":1.0}'
),
(
  'nng-heuristic',
  'Nielsen Norman — 10 Heuristics',
  'You are a Nielsen Norman Group senior researcher. Evaluate the UI against the 10 usability heuristics: visibility of system status, match between system and real world, user control, consistency, error prevention, recognition over recall, flexibility, aesthetic minimalism, help users recover, help and documentation. Score each heuristic 0-1.',
  '{"dimensions":["visibility","real_world_match","user_control","consistency","error_prevention","recognition","flexibility","minimalism","error_recovery","help"],"max_score":1.0}'
),
(
  'wcag-a11y',
  'WCAG 2.2 Accessibility',
  'You are a WCAG 2.2 accessibility auditor. Check contrast ratios (4.5:1 AA minimum), keyboard navigability, ARIA labels, focus management, heading hierarchy, and alt text. Flag any Level A or AA violations.',
  '{"dimensions":["contrast","keyboard","aria","focus","heading_hierarchy","alt_text"],"max_score":1.0}'
),
(
  'mobile-first',
  'Mobile First',
  'You are a mobile UX engineer reviewing for thumb-reach zones, touch target size (44dp minimum), one-handed usability, and safe-area handling. Flag any element that would cause problems on a compact (375px) viewport.',
  '{"dimensions":["thumb_reach","touch_targets","one_handed","safe_area","viewport_fit"],"max_score":1.0}'
),
(
  'glanceable-density',
  'Glanceable Density',
  'You are a consumer app designer evaluating for glanceability — can a user understand the screen purpose in under 2 seconds? Flag excessive text, cognitive overload, unclear hierarchy, and anything requiring more than one fixation to interpret.',
  '{"dimensions":["2s_comprehension","text_volume","hierarchy_clarity","cognitive_load","primary_action_visibility"],"max_score":1.0}'
)
on conflict (slug) do update set
  display_name = excluded.display_name,
  prompt       = excluded.prompt,
  rubric       = excluded.rubric;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. llm_cost_usd cross-cutting table (if not exists)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists llm_cost_usd (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references projects(id) on delete set null,
  operation       text not null,   -- 'cluster-coherence', 'lesson-summarise', 'pdca-producer', etc.
  model           text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cost_usd        numeric(12,6) not null default 0,
  occurred_at     timestamptz not null default now()
);

create index if not exists idx_llm_cost_project_op
  on llm_cost_usd (project_id, operation, occurred_at);

alter table llm_cost_usd enable row level security;

create policy "service_role_all_llm_cost"
  on llm_cost_usd for all using (true) with check (true);

create policy "org_members_read_llm_cost"
  on llm_cost_usd for select
  using (
    project_id is null
    or exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id
         and om.user_id = (select auth.uid())
    )
  );
