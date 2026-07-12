/*
FILE: 20260619140000_cross_app_app_domain.sql
PURPOSE: Add app_domain to cross-app reports RPC for SDK favicon rendering.
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
      left(r.id::text, 8) as short_id,
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
      p.slug as app_slug,
      (
        select
          case
            when o.origin ~* '^https?://' then
              split_part(
                regexp_replace(o.origin, '^https?://', ''),
                '/',
                1
              )
            else null
          end
        from (
          select k.last_seen_origin as origin
          from public.project_api_keys k
          where k.project_id = p.id
            and k.last_seen_origin is not null
            and coalesce(k.revoked, false) = false
          order by k.is_active desc nulls last, k.last_seen_at desc nulls last
          limit 1
        ) o
      ) as app_domain
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
