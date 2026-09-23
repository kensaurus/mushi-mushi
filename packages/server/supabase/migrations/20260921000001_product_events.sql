-- ============================================================================
-- FILE: 20260921000001_product_events.sql
-- PURPOSE: Product-analytics event stream ("Users & Funnels") — one table for
--          every project, written by POST /v1/sdk/events (Mushi.track()) and by
--          server-side emitters (_shared/product-events.ts). Mushi dogfoods it
--          for its own funnel under the mushi-self project.
--
-- Decoupled from end_user_activity (rewards engine, consent + scope gated) on
-- purpose: analytics must work on a default project key with zero rewards
-- config. See docs/plan-gtm.md → Workstream A.
-- ============================================================================

create table if not exists public.product_events (
  id           bigint generated always as identity primary key,
  project_id   uuid        not null references public.projects(id) on delete cascade,
  event_name   text        not null check (event_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  ts           timestamptz not null default now(),
  received_at  timestamptz not null default now(),
  session_id   text,
  -- Opaque per-project reporter token (same value the SDK already uses for
  -- reports/sessions). NULL under DNT / GPC / consent denied.
  anon_id      text,
  end_user_id  uuid        references public.end_users(id) on delete set null,
  surface      text        check (surface in ('web','console','docs','cli','mcp','server','mobile')),
  sdk_version  text,
  -- Optional idempotency key (nulls are distinct, so omitting it is fine).
  dedup_key    text,
  properties   jsonb       not null default '{}'::jsonb
                           check (pg_column_size(properties) <= 8192),
  constraint product_events_project_dedup unique (project_id, dedup_key)
);

comment on table public.product_events is
  'Product-analytics events per project (Mushi.track() + server emitters). Powers Users & Funnels and Mushi''s own growth funnel. Retention: project_settings.events_retention_days (default 90).';

create index if not exists product_events_project_ts
  on public.product_events (project_id, ts desc);
create index if not exists product_events_project_name_ts
  on public.product_events (project_id, event_name, ts desc);
create index if not exists product_events_project_person_ts
  on public.product_events (project_id, (coalesce(end_user_id::text, anon_id)), ts);
-- identify() backfill: rows still anonymous for a given anon_id.
create index if not exists product_events_project_anon_open
  on public.product_events (project_id, anon_id) where end_user_id is null;
create index if not exists product_events_props_gin
  on public.product_events using gin (properties jsonb_path_ops);

alter table public.product_events enable row level security;

-- Same shape as end_user_sessions: org members read their projects' rows.
-- Writes happen through the service role only.
drop policy if exists "org member read product_events" on public.product_events;
create policy "org member read product_events"
  on public.product_events for select to authenticated
  using (
    project_id in (
      select p.id from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
      where om.user_id = auth.uid()
    )
  );

-- Person properties for the People tab (allowlisted traits from identify()).
alter table public.end_users
  add column if not exists traits jsonb not null default '{}'::jsonb;
alter table public.end_users
  drop constraint if exists end_users_traits_size;
alter table public.end_users
  add constraint end_users_traits_size check (pg_column_size(traits) <= 2048);

-- Per-project switches.
alter table public.project_settings
  add column if not exists product_events_enabled boolean not null default true,
  add column if not exists events_retention_days integer
    check (events_retention_days is null or events_retention_days between 1 and 3650);

comment on column public.project_settings.events_retention_days is
  'Override for product_events retention in days. NULL = 90-day default. The mushi-self project runs at 730.';

-- ── Retention sweep (nightly, batched, advisory-locked) ─────────────────────
-- end_user_sessions has no TTL today and retention-sweep/index.ts only prunes
-- reports, so the least-coupled choice is a dedicated SQL cron. Batches of
-- 5k rows per loop keep the lock window short; pg_try_advisory_lock makes a
-- concurrent run a no-op. Three DISTINCT dollar-quote tags on purpose.
create or replace function public.prune_product_events(p_batch integer default 5000, p_max_batches integer default 40)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deleted integer := 0;
  v_round integer;
  v_batches integer := 0;
begin
  if not pg_try_advisory_lock(987654322) then
    return 0;
  end if;
  begin
    loop
      with victims as (
        select e.id
        from public.product_events e
        left join public.project_settings ps on ps.project_id = e.project_id
        where e.ts < now() - (coalesce(ps.events_retention_days, 90) * interval '1 day')
        limit p_batch
      )
      delete from public.product_events e using victims v where e.id = v.id;
      get diagnostics v_round = row_count;
      v_deleted := v_deleted + v_round;
      v_batches := v_batches + 1;
      exit when v_round < p_batch or v_batches >= p_max_batches;
    end loop;
  exception when others then
    perform pg_advisory_unlock(987654322);
    raise;
  end;
  perform pg_advisory_unlock(987654322);
  return v_deleted;
end;
$fn$;

revoke all on function public.prune_product_events(integer, integer) from public;

do $schedule$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'product-events-retention',
      '17 3 * * *',
      $cron$ select public.prune_product_events(); $cron$
    );
  end if;
end;
$schedule$;
