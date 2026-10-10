-- ============================================================================
-- 20261010131000_record_prompt_judge_score
--
-- recordPromptResult (_shared/prompt-ab.ts) read avg_judge_score and
-- total_evaluations, computed the new running average in JS and wrote both
-- back. judge-batch fires it without awaiting, once per stage per report, so
-- two scores for the same prompt version could read the same row and one
-- increment was lost until the nightly reconcile_prompt_version_scores.
--
-- This does the read-modify-write in one UPDATE: under READ COMMITTED a
-- concurrent UPDATE of the row waits and recomputes from the committed
-- values. Scope matches the old JS: version, project_id (NULL = global row)
-- and stage when given. It only writes when exactly one row matches, and
-- returns how many matched so the caller can log not-found or ambiguous.
-- ============================================================================

create or replace function public.record_prompt_judge_score(
  p_version text,
  p_score double precision,
  p_project_id uuid default null,
  p_stage text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
    from public.prompt_versions
   where version = p_version
     and project_id is not distinct from p_project_id
     and (p_stage is null or stage = p_stage);

  if coalesce(cardinality(v_ids), 0) <> 1 then
    return coalesce(cardinality(v_ids), 0);
  end if;

  update public.prompt_versions
     set avg_judge_score = (coalesce(avg_judge_score, 0) * coalesce(total_evaluations, 0) + p_score)
                           / (coalesce(total_evaluations, 0) + 1),
         total_evaluations = coalesce(total_evaluations, 0) + 1
   where id = v_ids[1];

  return 1;
end;
$fn$;

revoke all on function public.record_prompt_judge_score(text, double precision, uuid, text) from public, anon, authenticated;
grant execute on function public.record_prompt_judge_score(text, double precision, uuid, text) to service_role;
