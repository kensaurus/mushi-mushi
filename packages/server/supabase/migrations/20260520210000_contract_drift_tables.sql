-- contract_snapshots — stores the API/DB contract graph for a project at a point in time.
create table if not exists contract_snapshots (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  snapshot_at     timestamptz not null default now(),
  openapi         jsonb,
  inventory_nodes jsonb,
  pg_schema       jsonb,
  edge_count      integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_contract_snapshots_project on contract_snapshots (project_id, snapshot_at desc);

alter table contract_snapshots enable row level security;
create policy "service_role_all_contract_snapshots" on contract_snapshots for all using (true) with check (true);
create policy "org_members_read_contract_snapshots" on contract_snapshots for select
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id and om.user_id = (select auth.uid())
    )
  );

-- drift_findings — individual contract drift detected by the drift-walker
create table if not exists drift_findings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  snapshot_id     uuid references contract_snapshots(id) on delete set null,
  finding_type    text not null,
  severity        text not null default 'warn',
  surface         text not null,
  path            text,
  message         text not null,
  expected        jsonb,
  actual          jsonb,
  status          text not null default 'open',
  dismissed_at    timestamptz,
  dismissed_by    uuid,
  linked_report_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_drift_findings_project_status on drift_findings (project_id, status, severity, created_at desc);

alter table drift_findings enable row level security;
create policy "service_role_all_drift_findings" on drift_findings for all using (true) with check (true);
create policy "org_members_read_drift_findings" on drift_findings for select
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id and om.user_id = (select auth.uid())
    )
  );
create policy "org_members_write_drift_findings" on drift_findings for update
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

create or replace trigger trg_drift_findings_updated_at
  before update on drift_findings
  for each row execute function set_updated_at();
