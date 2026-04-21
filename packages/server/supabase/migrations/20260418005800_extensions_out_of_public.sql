-- §6: clear the `extension_in_public` Supabase security advisor
-- warning for `vector` by relocating it into a dedicated `extensions` schema.
--
-- Why this is safe:
--   * `ALTER EXTENSION ... SET SCHEMA` moves every object the extension owns
--     and PostgreSQL automatically rewrites column type references via the
--     dependency graph. Existing `embedding vector(N)` columns keep working;
--     they just resolve to `extensions.vector` under the hood.
--   * We append `extensions` to the `search_path` of the standard Supabase
--     roles so unqualified `vector` references (if any remain in app code)
--     keep resolving without a schema prefix.
--
-- Note on pg_net: Supabase's `pg_net` build is intentionally pinned to the
-- `public` schema and rejects `ALTER EXTENSION pg_net SET SCHEMA` with
-- `0A000: extension "pg_net" does not support SET SCHEMA`. The advisor
-- warning for pg_net therefore remains expected; Supabase support has
-- confirmed it is acceptable.
--
-- Idempotent: every step is guarded so a re-run is a no-op.

CREATE SCHEMA IF NOT EXISTS extensions;

GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role, postgres;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'vector'
       AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION vector SET SCHEMA extensions;
    RAISE NOTICE 'vector extension moved to extensions schema';
  END IF;
END
$$;

ALTER ROLE postgres      SET search_path TO "$user", public, extensions;
ALTER ROLE authenticator SET search_path TO "$user", public, extensions;
ALTER ROLE anon          SET search_path TO "$user", public, extensions;
ALTER ROLE authenticated SET search_path TO "$user", public, extensions;
ALTER ROLE service_role  SET search_path TO "$user", public, extensions;
