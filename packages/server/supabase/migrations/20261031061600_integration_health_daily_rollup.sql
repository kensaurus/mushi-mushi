-- integration_health_rollup() read every probe row of the last 14 days on
-- each dashboard / nav-meta load: 426k rows across 15 projects, 63 ms per
-- call for one owner and 513 ms for all projects, 15% of all database time
-- (pg_stat_statements, 2026-10-31). The uptime counts only need per-day
-- totals, so keep them in a small table that triggers maintain, and read the
-- raw history only for the partial first day and for the latest status
-- (one index probe per project + kind).
--
-- The result is identical to the old function: whole UTC days come from the
-- daily table, the part of the first day after p_since from the raw rows.

create table if not exists public.integration_health_daily (
  project_id uuid not null,
  kind text not null,
  day date not null,
  ok_count bigint not null default 0,
  total_count bigint not null default 0,
  primary key (project_id, kind, day)
);

alter table public.integration_health_daily enable row level security;
revoke all on public.integration_health_daily from anon, authenticated;

comment on table public.integration_health_daily is
  'Per-UTC-day probe counts per project + kind, maintained by triggers on integration_health_history. Read by integration_health_rollup(). Service role only.';

create or replace function public.integration_health_daily_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    insert into public.integration_health_daily as d (project_id, kind, day, ok_count, total_count)
    select o.project_id, o.kind, (o.checked_at at time zone 'UTC')::date,
           -count(*) filter (where o.status = 'ok'), -count(*)
      from old_rows o
     group by 1, 2, 3
    on conflict (project_id, kind, day) do update
      set ok_count = d.ok_count + excluded.ok_count,
          total_count = d.total_count + excluded.total_count;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.integration_health_daily as d (project_id, kind, day, ok_count, total_count)
    select n.project_id, n.kind, (n.checked_at at time zone 'UTC')::date,
           count(*) filter (where n.status = 'ok'), count(*)
      from new_rows n
     group by 1, 2, 3
    on conflict (project_id, kind, day) do update
      set ok_count = d.ok_count + excluded.ok_count,
          total_count = d.total_count + excluded.total_count;
  end if;
  return null;
end;
$$;

revoke execute on function public.integration_health_daily_apply() from public, anon, authenticated;

drop trigger if exists trg_integration_health_daily_ins on public.integration_health_history;
drop trigger if exists trg_integration_health_daily_upd on public.integration_health_history;
drop trigger if exists trg_integration_health_daily_del on public.integration_health_history;

create trigger trg_integration_health_daily_ins
  after insert on public.integration_health_history
  referencing new table as new_rows
  for each statement execute function public.integration_health_daily_apply();
create trigger trg_integration_health_daily_upd
  after update on public.integration_health_history
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.integration_health_daily_apply();
create trigger trg_integration_health_daily_del
  after delete on public.integration_health_history
  referencing old table as old_rows
  for each statement execute function public.integration_health_daily_apply();

-- Backfill from what is already there (runs once, inside this migration's
-- transaction, so no probe insert can be counted twice or missed).
lock table public.integration_health_history in share mode;
truncate public.integration_health_daily;
insert into public.integration_health_daily (project_id, kind, day, ok_count, total_count)
select project_id, kind, (checked_at at time zone 'UTC')::date,
       count(*) filter (where status = 'ok'), count(*)
  from public.integration_health_history
 group by 1, 2, 3;

create or replace function public.integration_health_rollup(p_project_ids uuid[], p_since timestamp with time zone)
returns table(project_id uuid, kind text, last_status text, last_at timestamp with time zone, ok_count bigint, total_count bigint)
language sql
stable
set search_path to 'public'
as $function$
  with bounds as (
    select ((p_since at time zone 'UTC')::date + 1) as first_full_day,
           (((p_since at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC') as first_full_at
  ),
  agg as (
    select x.project_id, x.kind, sum(x.ok)::bigint as ok_count, sum(x.total)::bigint as total_count
      from (
        select d.project_id, d.kind, d.ok_count as ok, d.total_count as total
          from public.integration_health_daily d, bounds b
         where d.project_id = any(p_project_ids)
           and d.day >= b.first_full_day
        union all
        select h.project_id, h.kind, count(*) filter (where h.status = 'ok'), count(*)
          from public.integration_health_history h, bounds b
         where h.project_id = any(p_project_ids)
           and h.checked_at >= p_since
           and h.checked_at < b.first_full_at
         group by h.project_id, h.kind
      ) x
     group by x.project_id, x.kind
    having sum(x.total) > 0
  )
  select a.project_id, a.kind, l.status, l.checked_at, a.ok_count, a.total_count
    from agg a
    cross join lateral (
      select h.status, h.checked_at
        from public.integration_health_history h
       where h.project_id = a.project_id
         and h.kind = a.kind
         and h.checked_at >= p_since
       order by h.checked_at desc
       limit 1
    ) l;
$function$;
