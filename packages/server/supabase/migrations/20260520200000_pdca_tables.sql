-- pdca_run_status
do $$ begin create type pdca_run_status as enum ('queued','running','succeeded','aborted','failed'); exception when duplicate_object then null; end $$;

-- pdca_runs
create table if not exists pdca_runs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  target_url          text not null,
  goal                text not null,
  iterations_target   integer not null default 5,
  current_iteration   integer not null default 0,
  status              pdca_run_status not null default 'queued',
  primary_model       text not null default 'claude-sonnet-4-6',
  judge_model         text not null default 'claude-sonnet-4-6',
  persona             text not null default 'nng-heuristic',
  target_score        float not null default 0.7,
  started_at          timestamptz,
  finished_at         timestamptz,
  final_score         float,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_pdca_runs_project_status on pdca_runs (project_id, status, created_at desc);

alter table pdca_runs enable row level security;
create policy "service_role_all_pdca_runs" on pdca_runs for all using (true) with check (true);
create policy "org_members_read_pdca_runs" on pdca_runs for select
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id and om.user_id = (select auth.uid())
    )
  );
create policy "org_members_write_pdca_runs" on pdca_runs for all
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id and om.user_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id and om.user_id = (select auth.uid())
    )
  );

create or replace trigger trg_pdca_runs_updated_at
  before update on pdca_runs
  for each row execute function set_updated_at();

-- pdca_iterations
create table if not exists pdca_iterations (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references pdca_runs(id) on delete cascade,
  iteration_n          integer not null,
  draft_html_url       text,
  screenshot_after_url text,
  critique_text        text,
  score                float,
  score_breakdown      jsonb not null default '{}',
  model_cost_usd       numeric(12,6) not null default 0,
  ms_elapsed           integer not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists idx_pdca_iterations_run on pdca_iterations (run_id, iteration_n);

alter table pdca_iterations enable row level security;
create policy "service_role_all_pdca_iterations" on pdca_iterations for all using (true) with check (true);
create policy "org_members_read_pdca_iterations" on pdca_iterations for select
  using (
    exists (
      select 1 from pdca_runs r
        join projects p on p.id = r.project_id
        join organization_members om on om.organization_id = p.organization_id
       where r.id = run_id and om.user_id = (select auth.uid())
    )
  );
