-- qa-story-runner: don't wake the cron for local stories, and keep a
-- matched minute due until a real run starts (2026-11-17).
--
-- The edge function used to insert status='skipped' for browser_provider
-- 'local' and for every story past 3 per project. Those rows advanced
-- last_run_at, so the same three stories ran and the rest starved.
-- Local stories run only through `mushi qa run`. A null provider stays
-- eligible (`is distinct from` keeps NULL; `<>` would drop it).
--
-- A slot stays due for 60 minutes (schedule.ts DUE_CARRY_MINUTES) when no
-- non-skipped qa_story_runs row has started at or after that minute, so
-- the next tick picks up what this tick could not run.
-- Pending and rejected stories are not work: the runner already refuses
-- them (isApprovedForSchedule).

create or replace function mushi.qa_story_runner_has_work(p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.qa_stories s
    cross join generate_series(0, 60) as g(mins_ago)
    cross join lateral (
      select
        regexp_split_to_array(btrim(coalesce(s.schedule_cron, '*/15 * * * *')), '\s+') as f,
        (date_trunc('minute', p_now) - make_interval(mins => g.mins_ago)) as slot
    ) parts
    where s.enabled = true
      and s.approval_status = 'approved'
      and s.browser_provider is distinct from 'local'
      and (
        coalesce(array_length(parts.f, 1), 0) < 5
        or (
          mushi.cron_field_may_match(parts.f[1], extract(minute from (parts.slot at time zone 'UTC'))::integer)
          and mushi.cron_field_may_match(parts.f[2], extract(hour from (parts.slot at time zone 'UTC'))::integer)
          and mushi.cron_field_may_match(parts.f[3], extract(day from (parts.slot at time zone 'UTC'))::integer)
          and mushi.cron_field_may_match(parts.f[4], extract(month from (parts.slot at time zone 'UTC'))::integer)
          and mushi.cron_field_may_match(parts.f[5], extract(dow from (parts.slot at time zone 'UTC'))::integer)
        )
      )
      and not exists (
        select 1
        from public.qa_story_runs r
        where r.story_id = s.id
          and r.status <> 'skipped'
          and r.started_at >= parts.slot
      )
  )
  or exists (
    select 1
    from public.qa_story_runs r
    where r.status = 'pending'
      and r.triggered_by = 'manual'
      and r.started_at < p_now - interval '10 minutes'
  )
$$;

revoke all on function mushi.qa_story_runner_has_work(timestamptz) from public, anon, authenticated;
