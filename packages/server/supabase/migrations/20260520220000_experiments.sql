-- experiments
create table if not exists experiments (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  name            text not null,
  description     text,
  hypothesis      text,
  status          text not null default 'draft',
  traffic_split   jsonb not null default '{"control": 0.5}',
  bandit_enabled  boolean not null default false,
  bandit_alpha    float not null default 1,
  bandit_beta     float not null default 1,
  start_at        timestamptz,
  end_at          timestamptz,
  winner_variant_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_experiments_project_status on experiments (project_id, status);

alter table experiments enable row level security;
create policy "service_role_all_experiments" on experiments for all using (true) with check (true);
create policy "org_members_read_experiments" on experiments for select
  using (exists (select 1 from projects p join organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())));
create policy "org_members_write_experiments" on experiments for all
  using (exists (select 1 from projects p join organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())))
  with check (exists (select 1 from projects p join organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())));
create or replace trigger trg_experiments_updated_at before update on experiments for each row execute function set_updated_at();

-- experiment_variants
create table if not exists experiment_variants (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references experiments(id) on delete cascade,
  name            text not null,
  description     text,
  config          jsonb not null default '{}',
  traffic_weight  float not null default 0.5,
  bandit_alpha    float not null default 1,
  bandit_beta     float not null default 1,
  created_at      timestamptz not null default now()
);

create index if not exists idx_experiment_variants_exp on experiment_variants (experiment_id);

alter table experiment_variants enable row level security;
create policy "service_role_all_experiment_variants" on experiment_variants for all using (true) with check (true);
create policy "org_members_read_experiment_variants" on experiment_variants for select
  using (exists (select 1 from experiments e join projects p on p.id = e.project_id join organization_members om on om.organization_id = p.organization_id where e.id = experiment_id and om.user_id = (select auth.uid())));

-- experiment_assignments
create table if not exists experiment_assignments (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references experiments(id) on delete cascade,
  variant_id      uuid not null references experiment_variants(id) on delete cascade,
  reporter_token  text not null,
  end_user_id     uuid,
  converted       boolean not null default false,
  converted_at    timestamptz,
  conversion_value float,
  created_at      timestamptz not null default now()
);

create unique index if not exists idx_experiment_assignments_unique on experiment_assignments (experiment_id, reporter_token);
create index if not exists idx_experiment_assignments_exp_var on experiment_assignments (experiment_id, variant_id, converted);

alter table experiment_assignments enable row level security;
create policy "service_role_all_experiment_assignments" on experiment_assignments for all using (true) with check (true);
create policy "org_members_read_experiment_assignments" on experiment_assignments for select
  using (exists (select 1 from experiments e join projects p on p.id = e.project_id join organization_members om on om.organization_id = p.organization_id where e.id = experiment_id and om.user_id = (select auth.uid())));
