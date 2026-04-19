-- =============================================================================
-- Tighten the `plugin_marketplace` alias view by switching to security_invoker.
--
-- Postgres views default to SECURITY DEFINER semantics, which means callers
-- inherit the view owner's RLS context. Supabase's linter flags this as an
-- ERROR-level finding because anon clients could bypass row-level filters.
--
-- Setting `security_invoker = true` makes the view evaluate underlying RLS
-- policies as the *querying* role, restoring the safety we'd get from the
-- base `plugin_registry` table.
-- =============================================================================

alter view if exists public.plugin_marketplace
  set (security_invoker = true);

comment on view public.plugin_marketplace is
  'Read-through alias for plugin_registry. Use the base table for writes. security_invoker=true so RLS runs as the caller.';
