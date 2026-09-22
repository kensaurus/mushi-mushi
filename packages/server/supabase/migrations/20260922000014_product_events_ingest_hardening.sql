-- ============================================================================
-- 20260922000014_product_events_ingest_hardening
--
-- Audit #15 follow-ups for POST /v1/sdk/events (routes/events.ts):
--
-- 1. Retention keys on received_at (server clock), not ts. ts comes from the
--    client (clamped to [received - 25 h, received + 5 min]), so pruning on it
--    let a client decide how long its rows live. New index for the sweep.
-- 2. product_event_names(project, limit): the distinct event names a project
--    has stored, for the maxEventNamesPerProject cardinality cap (200). A loose
--    index scan over product_events_project_name_ts, so it costs one index
--    probe per distinct name however many rows the project holds.
-- ============================================================================

create index if not exists product_events_received_at
  on public.product_events (received_at);

create or replace function public.prune_product_events(p_batch integer default 5000, p_max_batches integer default 40)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        where e.received_at < now() - (coalesce(ps.events_retention_days, 90) * interval '1 day')
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
$function$;

create or replace function public.product_event_names(p_project_id uuid, p_limit integer default 201)
returns text[]
language sql
stable
set search_path = public
as $fn$
  with recursive names(event_name) as (
    (select e.event_name
       from public.product_events e
      where e.project_id = p_project_id
      order by e.event_name
      limit 1)
    union all
    select (select e.event_name
              from public.product_events e
             where e.project_id = p_project_id
               and e.event_name > n.event_name
             order by e.event_name
             limit 1)
      from names n
     where n.event_name is not null
  )
  select coalesce(array_agg(s.event_name), '{}'::text[])
    from (select event_name from names where event_name is not null limit greatest(p_limit, 1)) s;
$fn$;

revoke all on function public.product_event_names(uuid, integer) from public, anon, authenticated;
grant execute on function public.product_event_names(uuid, integer) to service_role;
