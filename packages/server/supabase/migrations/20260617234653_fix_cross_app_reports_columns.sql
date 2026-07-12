/*
FILE: 20260618130000_fix_cross_app_reports_columns.sql
PURPOSE: Fix latent bug in mushi_get_my_cross_app_reports (Workstream D6).

PROBLEM:
- The RPC selected r.short_id and r.title, neither of which exists on the
  `reports` table (verified against the live schema). Any caller hit
  `column reports.short_id does not exist` and the cross-app "My Reports"
  view 500'd.

FIX:
- Derive a stable `short_id` from the report UUID (first 8 hex chars) and a
  human `title` from the existing `summary` (LLM triage headline) falling back
  to a trimmed `description`. No schema change to `reports` is needed — the
  data is already present under different column names.
- Behaviour, security (SECURITY DEFINER + pinned search_path), and the
  tester-gating contract are otherwise preserved exactly.
*/

create or replace function public.mushi_get_my_cross_app_reports(
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tester_id uuid;
  v_rows      jsonb;
begin
  select id into v_tester_id
  from public.mushi_testers
  where auth_user_id = auth.uid()
  limit 1;

  if v_tester_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_tester', 'reports', '[]'::jsonb);
  end if;

  select jsonb_agg(row_to_json(q)) into v_rows
  from (
    select
      r.id,
      -- Derived stable short id (the UUID's first 8 hex chars) — the table
      -- has no dedicated short_id column.
      left(r.id::text, 8) as short_id,
      -- Human title: prefer the LLM triage summary, fall back to a trimmed
      -- description so the row is never blank.
      coalesce(
        nullif(btrim(r.summary), ''),
        nullif(left(btrim(r.description), 80), '')
      ) as title,
      r.category,
      r.status,
      r.created_at,
      r.updated_at,
      p.id   as project_id,
      p.name as app_name,
      p.slug as app_slug
    from public.reports r
    left join public.projects p on p.id = r.project_id
    where r.tester_id = v_tester_id
    order by r.created_at desc
    limit  least(p_limit, 200)
    offset p_offset
  ) q;

  return jsonb_build_object(
    'ok',      true,
    'reports', coalesce(v_rows, '[]'::jsonb)
  );
end;
$function$;

notify pgrst, 'reload schema';
