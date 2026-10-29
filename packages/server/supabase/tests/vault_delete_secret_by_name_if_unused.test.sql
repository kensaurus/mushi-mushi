-- vault_delete_secret_by_name_if_unused contract (BL-098).
-- A Vault secret a byok_keys row still points at survives a legacy removal,
-- by name and by uuid; an unused one is deleted.
-- Run manually with a local Supabase DB after migrations:
--   supabase db reset && psql "$DATABASE_URL" -f packages/server/supabase/tests/vault_delete_secret_by_name_if_unused.test.sql

BEGIN;

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_shared_name text := 'byok-test-shared-' || v_suffix;
  v_unused_name text := 'byok-test-unused-' || v_suffix;
  v_unused_id_name text := 'byok-test-unused-id-' || v_suffix;
  v_shared uuid;
  v_unused uuid;
  v_unused_id uuid;
  v_deleted int;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'vault-test@example.test');

  v_shared := vault.create_secret('sk-ant-shared', v_shared_name);
  v_unused := vault.create_secret('sk-ant-unused', v_unused_name);
  v_unused_id := vault.create_secret('sk-ant-unused-id', v_unused_id_name);

  INSERT INTO public.byok_keys(owner_user_id, provider_slug, vault_secret_id)
  VALUES (v_user, 'anthropic', v_shared);

  v_deleted := public.vault_delete_secret_by_name_if_unused(v_shared_name);
  IF v_deleted <> 0 OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_shared) THEN
    RAISE EXCEPTION 'secret shared with a pooled key was deleted by name';
  END IF;

  v_deleted := public.vault_delete_secret_by_name_if_unused(v_shared::text);
  IF v_deleted <> 0 OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_shared) THEN
    RAISE EXCEPTION 'secret shared with a pooled key was deleted by uuid';
  END IF;

  v_deleted := public.vault_delete_secret_by_name_if_unused(v_unused_name);
  IF v_deleted <> 1 OR EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_unused) THEN
    RAISE EXCEPTION 'unused secret was not deleted by name';
  END IF;

  v_deleted := public.vault_delete_secret_by_name_if_unused(v_unused_id::text);
  IF v_deleted <> 1 OR EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_unused_id) THEN
    RAISE EXCEPTION 'unused secret was not deleted by uuid';
  END IF;

  IF public.vault_delete_secret_by_name_if_unused(NULL) <> 0
     OR public.vault_delete_secret_by_name_if_unused('') <> 0 THEN
    RAISE EXCEPTION 'empty name must delete nothing';
  END IF;
END;
$$;

ROLLBACK;
