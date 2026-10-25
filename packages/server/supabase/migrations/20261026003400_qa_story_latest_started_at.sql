-- One latest qa_story_runs.started_at per story for the scheduled
-- qa-story-runner tick (qa-story-runner/index.ts loadLastRuns).
--
-- A per-story select grew with the number of enabled cloud stories, and a
-- shared page of runs let a chatty story push another story's latest start
-- off PostgREST's row cap, which then looked unrun. DISTINCT ON returns one
-- row per story inside the lookback, however many runs that story has.
--
-- Service role only. The runner falls back to per-story reads when PostgREST
-- reports the function missing (PGRST202), so the edge function can deploy
-- before this migration is applied.
-- ============================================================================

create or replace function public.qa_story_latest_started_at(
  p_story_ids uuid[],
  p_since timestamptz
)
returns table (
  story_id uuid,
  started_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $latest$
  select distinct on (r.story_id) r.story_id, r.started_at
    from public.qa_story_runs r
   where r.story_id = any(p_story_ids)
     and r.started_at >= p_since
   order by r.story_id, r.started_at desc;
$latest$;

comment on function public.qa_story_latest_started_at(uuid[], timestamptz) is
  'Latest qa_story_runs.started_at per story at or after p_since. Service role only (qa-story-runner scheduled tick).';

revoke all on function public.qa_story_latest_started_at(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.qa_story_latest_started_at(uuid[], timestamptz) to service_role;
