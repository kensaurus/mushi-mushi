-- Rejected report ingests, counted per app, UTC day, stage, reason and SDK
-- package, so the console can show what an app's reporters lost.
--
-- On 2026-10-26 yen-yen's Android app got 400 on every POST /v1/reports: the
-- React Native fingerprint digest failed a regex, so no RN report had landed
-- since 2026-06-18, and the access log said only "400". The API now logs each
-- rejection (field paths and zod codes, never values) and counts it here.
--
-- A counter, not a row per request: the body check runs before the burst rate
-- limit, so a key spamming invalid payloads must not grow the table. Rows are
-- bounded by apps × days × distinct reasons.

create table if not exists public.report_ingest_rejections (
  project_id uuid not null references public.projects(id) on delete cascade,
  day date not null,
  stage text not null check (stage in ('body', 'submission', 'screenshot', 'batch')),
  -- The first validation issue as `path:code`, e.g. `fingerprintHash:invalid_string`.
  reason text not null check (char_length(reason) between 1 and 200),
  -- `@mushi-mushi/<name>` when the payload named one, else ''.
  sdk_package text not null default '' check (char_length(sdk_package) <= 80),
  count integer not null default 0 check (count >= 0),
  last_at timestamptz not null default now(),
  primary key (project_id, day, stage, reason, sdk_package)
);

create index if not exists idx_report_ingest_rejections_day on public.report_ingest_rejections (day);

comment on table public.report_ingest_rejections is
  'Rejected POST /v1/reports and /v1/reports/batch payloads per app and UTC day (stage, first issue as path:code, SDK package). Written by count_report_ingest_rejection() from the api function only.';

alter table public.report_ingest_rejections enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_ingest_rejections' and policyname = 'report_ingest_rejections_member_select') then
    create policy report_ingest_rejections_member_select on public.report_ingest_rejections
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_ingest_rejections' and policyname = 'report_ingest_rejections_service_write') then
    create policy report_ingest_rejections_service_write on public.report_ingest_rejections
      for all to service_role using (true) with check (true);
  end if;
end $$;

revoke all on table public.report_ingest_rejections from anon;
revoke insert, update, delete, truncate on table public.report_ingest_rejections from authenticated;
grant select on table public.report_ingest_rejections to authenticated;

-- One rejection: +1 on today's row for (app, stage, reason, package).
create or replace function public.count_report_ingest_rejection(
  p_project_id uuid,
  p_stage text,
  p_reason text,
  p_sdk_package text default ''
) returns void
language sql
set search_path = ''
as $$
  insert into public.report_ingest_rejections (project_id, day, stage, reason, sdk_package, count, last_at)
  values (p_project_id, (now() at time zone 'utc')::date, p_stage, left(p_reason, 200), left(coalesce(p_sdk_package, ''), 80), 1, now())
  on conflict (project_id, day, stage, reason, sdk_package)
  do update set count = public.report_ingest_rejections.count + 1, last_at = excluded.last_at;
$$;

revoke all on function public.count_report_ingest_rejection(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.count_report_ingest_rejection(uuid, text, text, text) to service_role;
