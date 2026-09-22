-- ============================================================================
-- FILE: 20260921000003_product_events_hardening.sql
-- PURPOSE: Close the Supabase advisor findings on 20260921000001_product_events:
--   * prune_product_events was executable by anon/authenticated (SECURITY DEFINER)
--   * product_events carried Supabase's default anon/authenticated table grants
--     (writes are service-role only; reads are RLS-scoped for authenticated)
--   * the RLS policy evaluated auth.uid() per row (use (select auth.uid()))
--   * end_user_id FK had no covering index
-- ============================================================================

revoke execute on function public.prune_product_events(integer, integer) from anon, authenticated;

revoke all on table public.product_events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.product_events from authenticated;

drop policy if exists "org member read product_events" on public.product_events;
create policy "org member read product_events"
  on public.product_events for select to authenticated
  using (
    project_id in (
      select p.id from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
      where om.user_id = (select auth.uid())
    )
  );

create index if not exists product_events_end_user_id
  on public.product_events (end_user_id) where end_user_id is not null;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
