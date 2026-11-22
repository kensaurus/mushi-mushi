-- qa-story-runner-tick: send the minute it checked (2026-11-11).
--
-- 20261111091825_cron_edge_work_gates made the job post only when a story
-- is due this minute. The runner then matched schedules against the time the
-- call arrived, so a call pg_net delivered in the next minute would find
-- nothing due and the story would be skipped. The job now checks and sends
-- one truncated minute; the runner (qa-story-runner/cron-tick.ts) matches
-- against it. Older runner code ignores the extra `tick` key (the body
-- schema passes unknown keys through).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qa-story-runner-tick') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'qa-story-runner-tick'),
      command := $cmd$select mushi.edge_function_post('qa-story-runner', jsonb_build_object('trigger', 'cron', 'tick', date_trunc('minute', now()))) where mushi.qa_story_runner_has_work(date_trunc('minute', now()));$cmd$
    );
  end if;
end
$$;
