-- ============================================================================
-- 20261010180600_promote_prompt_candidate_lock
--
-- promote_prompt_candidate (20260511120100) made the swap atomic, but two
-- promotions for the same project + stage could still interleave: under
-- READ COMMITTED each deactivates the rows its snapshot saw as active and
-- then activates its own candidate, leaving two active prompts.
--
-- 1. The function takes a transaction advisory lock on (project, stage)
--    first, so a second promotion waits and its UPDATEs then see the first
--    one's committed rows: the later promotion wins, cleanly.
-- 2. A partial unique index allows one active row per (project, stage),
--    global rows (project_id NULL) included, so no other writer can leave
--    two. The app already reads the active row with .maybeSingle(). No
--    scope had more than one active row on the hosted project when this was
--    written.
--
-- Body otherwise unchanged from the live definition.
-- ============================================================================

create unique index if not exists uq_prompt_versions_one_active
  on public.prompt_versions (coalesce(project_id::text, 'global'), stage)
  where is_active;

create or replace function public.promote_prompt_candidate(
  p_project_id  uuid,
  p_stage       text,
  p_candidate_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform pg_advisory_xact_lock(
    hashtext('promote_prompt_candidate'),
    hashtext(coalesce(p_project_id::text, 'global') || ':' || p_stage)
  );

  update prompt_versions
  set    is_active = false
  where  project_id = p_project_id
    and  stage      = p_stage
    and  is_active  = true
    and  version   != p_candidate_version;

  update prompt_versions
  set    is_active          = true,
         is_candidate       = false,
         traffic_percentage = 100
  where  project_id = p_project_id
    and  stage      = p_stage
    and  version    = p_candidate_version;

  if not found then
    raise exception 'promote_prompt_candidate: no row found for project_id=%, stage=%, version=%',
      p_project_id, p_stage, p_candidate_version;
  end if;
end;
$fn$;

revoke execute on function public.promote_prompt_candidate(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.promote_prompt_candidate(uuid, text, text) to service_role;
