-- "Merge when ready" (ADR 0041): pull requests a person queued from the
-- console. The merge-queue worker takes one PR per repo at a time: updates a
-- branch that is behind, waits for CI on its head, merges through the review
-- gate (ADR 0030), and asks a Cursor agent to resolve a merge conflict.

create table if not exists public.fix_merge_queue (
  id uuid primary key default gen_random_uuid(),
  fix_attempt_id uuid not null unique references public.fix_attempts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- owner/name, lower case: the queue runs one PR per repo at a time.
  repo text not null,
  pr_number integer not null,
  state text not null default 'queued' check (state in ('queued', 'waiting', 'resolving', 'blocked', 'merged', 'removed')),
  detail text,
  head_sha text,
  queued_by uuid references auth.users(id) on delete set null,
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  merged_at timestamptz,
  conflict_agents integer not null default 0,
  cursor_agent_id text,
  agent_started_at timestamptz,
  agent_head_sha text,
  claimed_until timestamptz
);

create index if not exists idx_fix_merge_queue_active
  on public.fix_merge_queue (repo, queued_at)
  where state in ('queued', 'waiting', 'resolving', 'blocked');

alter table public.fix_merge_queue enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fix_merge_queue' and policyname = 'fix_merge_queue_member_select') then
    create policy fix_merge_queue_member_select on public.fix_merge_queue
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fix_merge_queue' and policyname = 'fix_merge_queue_service_write') then
    create policy fix_merge_queue_service_write on public.fix_merge_queue
      for all to service_role using (true) with check (true);
  end if;
end $$;

grant select on table public.fix_merge_queue to authenticated;
revoke all on table public.fix_merge_queue from anon;

-- fix_events.kind: append 'merge_queue' to the live list.
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['merge_queue'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.fix_events'::regclass
     AND conname = 'fix_events_kind_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix_events_kind_check not found; refusing to guess the allowed kinds';
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.fix_events DROP CONSTRAINT fix_events_kind_check';
  EXECUTE format(
    'ALTER TABLE public.fix_events ADD CONSTRAINT fix_events_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

-- Every 5 minutes (:01 to :56).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-merge-queue schedule';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-merge-queue';
  PERFORM cron.schedule(
    'mushi-merge-queue',
    '1-56/5 * * * *',
    $cmd$select mushi.cron_http_post('merge-queue', jsonb_build_object('trigger', 'cron'));$cmd$
  );
END $$;
