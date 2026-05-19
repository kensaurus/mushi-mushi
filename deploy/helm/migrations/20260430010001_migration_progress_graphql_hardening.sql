-- =============================================================================
-- migration_progress GraphQL hardening — collapse the
-- pg_graphql_anon_table_exposed / pg_graphql_authenticated_table_exposed
-- advisor warnings on `public.migration_progress`.
--
-- Background:
--   The Migration Hub Phase 2 table is reached ONLY through the Hono Edge
--   Function `/v1/admin/migrations/progress` (apps/server, see
--   supabase/functions/api/routes/migration-progress.ts), which uses the
--   service-role client and applies its own JWT auth + project access
--   checks. No client ever queries the table through PostgREST or the
--   auto-generated pg_graphql schema.
--
--   Supabase's default `public` GRANT to `anon` + `authenticated` therefore
--   serves no purpose here, but does cause the table to show up in the
--   GraphQL schema discovery. Even though RLS denies anonymous reads
--   (every policy is TO authenticated), a curious unauthenticated visitor
--   can still see that the table EXISTS via the GraphQL schema.
--
--   Revoke all GRANTs from anon + authenticated to remove the table from
--   discovery entirely. Service role keeps full access (it bypasses the
--   GRANT system anyway, but we keep it explicit).
--
-- Why a separate migration file:
--   The previous migration (20260430010000_migration_progress.sql) is now
--   a stable, applied snapshot. Adding a fresh file documents WHY this
--   change exists and lets a reader follow the security evolution without
--   diff archaeology.
-- =============================================================================

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.migration_progress FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.migration_progress FROM authenticated;

-- Defensive re-grant for service_role. Supabase already grants this by
-- default to all tables in `public`, but spelling it out keeps the intent
-- explicit and survives any future "lock down public schema" sweep.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.migration_progress TO service_role;
