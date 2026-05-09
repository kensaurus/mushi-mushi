-- 20260509000003_security_harden_advisor_findings.sql
--
-- Closes the only remaining ERROR-level finding in the Supabase security
-- advisor and the entire batch of WARN-level "mutable search_path" findings.
-- Run after the 2026-05-09 webhook-hardening migrations because it also
-- patches the policies they introduced.
--
-- Findings addressed (Supabase advisor lint codes in parentheses):
--   1. discovery_observed_inventory  — security_definer_view (0010)  ERROR
--   2. sdk_versions                  — rls_enabled_no_policy (0008)   INFO
--   3. 6 functions in public.*       — function_search_path_mutable (0011) WARN
--
-- All three are silent surface-area risks: they are not exploitable today
-- but become exploitable the moment future grants change. Fixing them
-- pre-emptively means an attacker who later compromises a single role
-- cannot pivot through them.

-- =============================================================================
-- 1. discovery_observed_inventory  (ERROR: security_definer_view)
-- =============================================================================
-- Postgres views default to running with the privileges of the view *creator*
-- ("security definer"). The discovery_observed_inventory view aggregates
-- discovery_events across the last 30 days; today the view is REVOKEd from
-- anon/authenticated so the bypass is unreachable, but anybody who later
-- runs `GRANT SELECT ON discovery_observed_inventory TO authenticated;`
-- would silently leak every project's discovery data because RLS on
-- discovery_events would not be enforced.
--
-- Switching to security_invoker = true makes the view honour the caller's
-- RLS policies, so a future GRANT becomes safe by default.
alter view public.discovery_observed_inventory set (security_invoker = true);

-- =============================================================================
-- 2. sdk_versions  (INFO: rls_enabled_no_policy)
-- =============================================================================
-- This table is the source of truth for "which SDK version are you on?" and
-- is meant to be world-readable so the SDK self-check works without a
-- service-role token. RLS was enabled but no policies existed, which means
-- every read was silently denied.
--
-- Add explicit, intent-revealing policies:
--   - public read   : anyone can SELECT                (intentional catalog)
--   - service role  : the publishing pipeline can write
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sdk_versions'
      and policyname = 'public read'
  ) then
    create policy "public read"
      on public.sdk_versions
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sdk_versions'
      and policyname = 'service role write'
  ) then
    create policy "service role write"
      on public.sdk_versions
      for all to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- =============================================================================
-- 3. mutable search_path on 6 public functions  (WARN: function_search_path_mutable)
-- =============================================================================
-- A function with no `SET search_path = …` inherits whatever search_path
-- the caller has at runtime. An attacker with CREATE on `pg_temp` (anyone
-- with a session) can shadow built-ins like `pg_catalog.lower()` or
-- `public.users` and, when the function executes, call the attacker's
-- version instead.
--
-- Pinning search_path to `public, pg_catalog` removes the vector while
-- keeping the existing un-qualified function bodies working. We deliberately
-- do not switch to `''` because several of these functions reference
-- public-schema tables un-qualified.
alter function public.guard_last_organization_owner()              set search_path = public, pg_catalog;
alter function public.organization_members_touch_updated_at()      set search_path = public, pg_catalog;
alter function public.enforce_invitation_plan_gate()               set search_path = public, pg_catalog;
alter function public.inventory_user_story_tree(uuid)              set search_path = public, pg_catalog;
alter function public.inventory_status_summary(uuid)               set search_path = public, pg_catalog;
alter function public.api_key_has_scope(text[], text)              set search_path = public, pg_catalog;

comment on function public.api_key_has_scope(text[], text) is
  'Returns true when an API key''s scope array contains the required scope. '
  'search_path is pinned to (public, pg_catalog) per advisor lint 0011 so a '
  'temp-schema attacker cannot shadow builtins.';
