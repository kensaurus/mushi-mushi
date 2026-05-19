-- =============================================================================
-- Sweep up Supabase advisor lints introduced by older migrations:
--   * Switch `fix_coordination_summary` to security_invoker so RLS runs as
--     the caller, not the view owner. Pulls it out of the ERROR-level lint.
--   * Pin search_path on the listed functions so they cannot be hijacked by
--     a session-level search_path override.
-- All changes are idempotent and safe to re-apply.
-- =============================================================================

alter view if exists public.fix_coordination_summary
  set (security_invoker = true);

do $$
declare
  fn record;
  fns text[] := array[
    'public.billing_usage_unsynced_summary',
    'public.mushi_sync_region_routing',
    'public.mushi_current_region',
    'public.prune_sandbox_events_per_project',
    'public.mushi_touch_updated_at',
    'public.mushi_age_available',
    'public.match_codebase_files',
    'public.seed_project_member_for_owner'
  ];
  qualified text;
begin
  foreach qualified in array fns loop
    for fn in
      select n.nspname as schema_name,
             p.proname as func_name,
             pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname || '.' || p.proname) = qualified
    loop
      execute format(
        'alter function %I.%I(%s) set search_path = pg_catalog, public',
        fn.schema_name, fn.func_name, fn.args
      );
    end loop;
  end loop;
end$$;
