-- metric_series
create table if not exists metric_series (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  metric_name     text not null,
  dimension       text,
  ts              timestamptz not null,
  value           double precision not null,
  release_id      uuid references releases(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_metric_series_project_metric on metric_series (project_id, metric_name, ts desc);
create index if not exists idx_metric_series_ts on metric_series (ts);

alter table metric_series enable row level security;
create policy "service_role_all_metric_series" on metric_series for all using (true) with check (true);
create policy "org_members_read_metric_series" on metric_series for select
  using (exists (select 1 from projects p join organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())));
create policy "org_members_write_metric_series" on metric_series for insert
  with check (exists (select 1 from projects p join organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())));

-- anomaly_detections
create table if not exists anomaly_detections (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  metric_name     text not null,
  detected_at     timestamptz not null,
  method          text not null,
  score           double precision not null,
  threshold       double precision not null,
  value           double precision not null,
  baseline_mean   double precision,
  baseline_std    double precision,
  status          text not null default 'open',
  confirmed       boolean not null default false,
  release_id      uuid references releases(id) on delete set null,
  auto_report_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_anomaly_detections_project on anomaly_detections (project_id, status, detected_at desc);

alter table anomaly_detections enable row level security;
create policy "service_role_all_anomaly_detections" on anomaly_detections for all using (true) with check (true);
create policy "org_members_read_anomaly_detections" on anomaly_detections for select
  using (exists (select 1 from projects p join organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())));
create or replace trigger trg_anomaly_detections_updated_at before update on anomaly_detections for each row execute function set_updated_at();
