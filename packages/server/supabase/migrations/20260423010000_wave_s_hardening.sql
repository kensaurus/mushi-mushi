-- ============================================================
-- Wave S hardening (2026-04-23)
-- ============================================================
--
-- Consolidates the post-audit DB hardening items flagged during the
-- 2026-04-22 perf + security sweep. Each section is independent and safe
-- to re-run (idempotent DDL + conditional DML). We keep them in one
-- migration so the ops envelope is a single `supabase db push`.
--
-- Sections:
--   1. Generic scoped rate-limit claim RPC (decouples /assist + /intelligence
--      from the NL-query-specific table). The existing nl_query_rate_limit_*
--      functions stay in place for back-compat — callers migrate incrementally.
--   2. `fix_dispatch_jobs` atomic claim via SELECT ... FOR UPDATE SKIP LOCKED.
--      Removes the "two workers race on status='queued'" window when we add
--      a second orchestrator.
--   3. CHECK constraint on `fix_attempts.verify_steps` structure — the JSONB
--      column is freeform, so an upstream writer bug can silently corrupt
--      rows the Judge then reads. We gate writes on the minimum shape.
--   4. `updated_at` trigger on `fix_dispatch_jobs` — several joins on the
--      admin UI order by `updated_at DESC` assuming it exists; today it
--      does not, so rows sort by `created_at` and new runs appear stale.
--   5. Minute-level rate cap for NL-query — an hourly bucket still lets an
--      attacker drain 60 expensive LLM calls in 60 seconds. A 10/minute
--      sub-cap smooths the burst without changing the hourly budget.
--   6. Retroactive cost_usd backfill — widens the earlier 2026-04-20
--      cutoff to catch rows logged between 20260420 and this migration
--      using any of the Wave R model IDs that the earlier VALUES list
--      didn't know about (Opus 4.7 fallback paths, gpt-5.4 retries).

-- -------------------------------------------------------------
-- 1. Generic scoped rate-limit claim
-- -------------------------------------------------------------

create table if not exists scoped_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, scope, window_start)
);

create index if not exists scoped_rate_limits_user_scope_window_idx
  on scoped_rate_limits (user_id, scope, window_start desc);

-- Atomic claim. `p_window` must be a positive interval; we truncate to the
-- window base so multiple callers inside the same window collide on a
-- single row (cheap contention, no gap/overlap).
create or replace function scoped_rate_limit_claim(
  p_user_id uuid,
  p_scope text,
  p_max_per_window integer,
  p_window interval default '1 hour'
) returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  -- `date_bin` avoids the `trunc to hour/minute` switch dance — it buckets
  -- any interval against a stable epoch, so callers can pass '10 seconds'
  -- or '5 minutes' and the math still works.
  v_window timestamptz := date_bin(p_window, now(), 'epoch'::timestamptz);
  v_count integer;
begin
  if p_max_per_window <= 0 then
    raise exception 'scoped_rate_limit_claim: p_max_per_window must be > 0';
  end if;

  insert into scoped_rate_limits (user_id, scope, window_start, request_count)
  values (p_user_id, p_scope, v_window, 1)
  on conflict (user_id, scope, window_start)
    do update set request_count = scoped_rate_limits.request_count + 1
  returning request_count into v_count;

  if v_count > p_max_per_window then
    raise exception 'rate_limit_exceeded: scope=% count=% cap=% window=%',
      p_scope, v_count, p_max_per_window, p_window
      using errcode = 'P0001';
  end if;

  return v_count;
end;
$$;

revoke all on function scoped_rate_limit_claim(uuid, text, integer, interval) from public;
grant execute on function scoped_rate_limit_claim(uuid, text, integer, interval) to service_role;

alter table scoped_rate_limits enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'scoped_rate_limits'
       and policyname = 'scoped_rate_limits_self_read'
  ) then
    create policy "scoped_rate_limits_self_read" on scoped_rate_limits
      for select using ((select auth.uid()) = user_id);
  end if;
end $$;

create or replace function scoped_rate_limit_prune(p_older_than interval default '7 days')
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_deleted integer;
begin
  delete from scoped_rate_limits
   where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function scoped_rate_limit_prune(interval) from public;
grant execute on function scoped_rate_limit_prune(interval) to service_role;

-- -------------------------------------------------------------
-- 2. fix_dispatch_jobs atomic claim
-- -------------------------------------------------------------
-- Today the fix-worker edge function runs a compare-and-swap UPDATE
-- (`status='queued' -> 'running'`). That's safe for one caller at a time
-- but silently drops the losing write when two workers race — operators
-- see one dispatch "stuck in queued" until a manual retry. SKIP LOCKED
-- gives us a real queue semantics without a new table.

create or replace function fix_dispatch_claim_next(
  p_limit integer default 1
) returns setof fix_dispatch_jobs
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  return query
  with next as (
    select id
      from fix_dispatch_jobs
     where status = 'queued'
     order by created_at asc
     limit greatest(1, p_limit)
     for update skip locked
  )
  update fix_dispatch_jobs d
     set status = 'running',
         started_at = now()
    from next
   where d.id = next.id
  returning d.*;
end;
$$;

revoke all on function fix_dispatch_claim_next(integer) from public;
grant execute on function fix_dispatch_claim_next(integer) to service_role;

comment on function fix_dispatch_claim_next(integer) is
  'Atomic claim of up to N queued dispatch jobs. Uses SKIP LOCKED so concurrent workers do not block or double-claim. Prefer over the inline UPDATE ... WHERE status=queued pattern in fix-worker when you add a second orchestrator.';

-- -------------------------------------------------------------
-- 3. fix_attempts.verify_steps CHECK
-- -------------------------------------------------------------
-- `verify_steps` shape is documented in 20260422120000. A typo in the
-- writer can silently produce `{"ok": true}` or an array, which the Judge
-- happily consumes but then scores as "missing verification". Gate the
-- column on its minimum required shape so bad writes fail fast.

alter table if exists fix_attempts
  drop constraint if exists fix_attempts_verify_steps_shape;

alter table if exists fix_attempts
  add constraint fix_attempts_verify_steps_shape
  check (
    verify_steps is null
    or (
      jsonb_typeof(verify_steps) = 'object'
      and verify_steps ? 'status'
      and verify_steps ->> 'status' in ('passed', 'failed', 'error')
    )
  )
  not valid;

-- Validate in a second step so existing rows (if any) don't block the
-- migration. Failures surface in `pg_catalog.pg_constraint.convalidated`
-- for a DBA to clean up manually.
do $$
begin
  begin
    alter table fix_attempts validate constraint fix_attempts_verify_steps_shape;
  exception when check_violation then
    raise notice 'fix_attempts_verify_steps_shape has existing violations; leaving NOT VALID so reads keep working';
  end;
end $$;

-- -------------------------------------------------------------
-- 4. updated_at trigger on fix_dispatch_jobs
-- -------------------------------------------------------------
-- Ordering dispatches by "most recently touched" is a common admin UI
-- pattern — adding the column + trigger once here avoids a handful of
-- ad-hoc `coalesce(finished_at, started_at, created_at)` expressions in
-- the app.

alter table if exists fix_dispatch_jobs
  add column if not exists updated_at timestamptz not null default now();

-- Shared trigger fn; create it idempotently in case a newer migration
-- already installed it.
create or replace function set_updated_at_on_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'fix_dispatch_jobs_updated_at'
       and tgrelid = 'fix_dispatch_jobs'::regclass
  ) then
    create trigger fix_dispatch_jobs_updated_at
      before update on fix_dispatch_jobs
      for each row
      execute function set_updated_at_on_row();
  end if;
end $$;

-- -------------------------------------------------------------
-- 5. Minute-level cap on NL-query
-- -------------------------------------------------------------
-- Wraps the existing hourly RPC: claims the hourly bucket first (keeps
-- long-term back-pressure), then claims a per-minute sub-bucket on the
-- new scoped_rate_limits table (smooths bursts). We deliberately don't
-- inline the minute logic into nl_query_rate_limit_claim — the hourly
-- function has a stable grant surface.

create or replace function nl_query_rate_limit_claim_with_burst(
  p_user_id uuid,
  p_max_per_hour integer default 60,
  p_max_per_minute integer default 10
) returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_hour integer;
begin
  v_hour := nl_query_rate_limit_claim(p_user_id, p_max_per_hour);
  perform scoped_rate_limit_claim(p_user_id, 'nl_query_minute', p_max_per_minute, interval '1 minute');
  return v_hour;
end;
$$;

revoke all on function nl_query_rate_limit_claim_with_burst(uuid, integer, integer) from public;
grant execute on function nl_query_rate_limit_claim_with_burst(uuid, integer, integer) to service_role;

-- -------------------------------------------------------------
-- 6. Widen cost_usd backfill for Wave R model IDs
-- -------------------------------------------------------------
-- 20260422100000 gated the retro-fill on `created_at >= '2026-04-20'`.
-- Rows logged between 2026-04-18 (when we first wrote llm_invocations
-- with the new `used_model` field) and 2026-04-20 still sit at the
-- fallback $3/$15 cost. Re-run with the wider window but limit to rows
-- whose current cost looks like the fallback (input*3 + output*15)/1M
-- so we don't clobber correctly-priced rows.

with pricing(model, in_per_m, out_per_m) as (
  values
    ('claude-haiku-4-5-20251001',  1.00::numeric,  5.00::numeric),
    ('claude-haiku-4-5',           1.00::numeric,  5.00::numeric),
    ('claude-sonnet-4-5-20250929', 3.00::numeric, 15.00::numeric),
    ('claude-sonnet-4-6',          3.00::numeric, 15.00::numeric),
    ('claude-opus-4-7',           15.00::numeric, 75.00::numeric),
    ('gpt-5.4',                    5.00::numeric, 15.00::numeric),
    ('gpt-5.4-mini',               0.60::numeric,  2.40::numeric)
)
update llm_invocations inv
   set cost_usd = (
         (coalesce(inv.input_tokens, 0)  * p.in_per_m)
       + (coalesce(inv.output_tokens, 0) * p.out_per_m)
       ) / 1000000.0
  from pricing p
 where p.model = lower(substring(inv.used_model from '[^/]+$'))
   and inv.created_at >= '2026-04-18'::timestamptz
   and inv.created_at <  '2026-04-23'::timestamptz
   -- Only overwrite rows that still look like the fallback — protects
   -- hand-set rows and the already-correct retro-fill from 20260422100000.
   and abs(
        coalesce(inv.cost_usd, 0)
        - (
            (coalesce(inv.input_tokens, 0)  * 3.00::numeric)
          + (coalesce(inv.output_tokens, 0) * 15.00::numeric)
          ) / 1000000.0
      ) < 0.000001;
