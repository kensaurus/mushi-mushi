-- Last-owner guard contract (migration 20261030120000).
-- Run manually with a local Supabase DB after migrations:
--   supabase db reset && psql "$DATABASE_URL" -f packages/server/supabase/tests/org_last_owner_guard.test.sql
--
-- An organization never loses its last owner while it exists, but deleting
-- the whole organization works (the synthetic-account sweep relies on it).

BEGIN;

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_refused boolean := false;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'last-owner@example.test');
  INSERT INTO public.organizations(id, slug, name, owner_id, plan_id)
  VALUES (v_org, 'test-org-last-owner', 'Last Owner Test Org', v_owner, 'free_cloud');
  INSERT INTO public.organization_members(organization_id, user_id, role) VALUES (v_org, v_owner, 'owner');

  BEGIN
    DELETE FROM public.organization_members WHERE organization_id = v_org AND user_id = v_owner;
  EXCEPTION WHEN raise_exception THEN
    v_refused := SQLERRM = 'cannot_remove_last_owner';
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'the last owner must not leave an organization that stays';
  END IF;

  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = v_org) THEN
    RAISE EXCEPTION 'deleting the organization must take its members with it';
  END IF;
END;
$$;

ROLLBACK;
