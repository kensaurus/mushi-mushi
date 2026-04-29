-- Migration Hub Phase 2 RLS smoke contract.
-- Run manually with a local Supabase DB after migrations:
--   supabase db reset && psql "$DATABASE_URL" -f packages/server/supabase/tests/rls_migration_progress.test.sql
--
-- Pins the policies installed by 20260430010000_migration_progress.sql:
--   * Owner of an account-scoped row can read/write/delete it; outsiders cannot.
--   * Project members can READ project-scoped rows owned by teammates,
--     but cannot INSERT/UPDATE/DELETE on someone else's behalf.
--   * Outsiders can neither read nor write project-scoped rows.

BEGIN;

DO $$
DECLARE
  v_owner    uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_viewer   uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_org      uuid := gen_random_uuid();
  v_project  uuid := gen_random_uuid();
  v_count    integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner,    'owner@example.test'),
    (v_admin,    'admin@example.test'),
    (v_viewer,   'viewer@example.test'),
    (v_outsider, 'outsider@example.test');

  INSERT INTO public.organizations(id, slug, name, owner_id, plan_id)
  VALUES (v_org, 'test-org-mp', 'Migration Progress Test Org', v_owner, 'pro');

  INSERT INTO public.organization_members(organization_id, user_id, role) VALUES
    (v_org, v_owner,  'owner'),
    (v_org, v_admin,  'admin'),
    (v_org, v_viewer, 'viewer');

  INSERT INTO public.projects(id, slug, name, owner_id, organization_id)
  VALUES (v_project, 'mp-test-project', 'Migration Progress Test Project', v_owner, v_org);

  -- Seed two rows as service role (bypassing RLS):
  --   * account-scoped progress for the owner
  --   * project-scoped progress for the owner on v_project
  INSERT INTO public.migration_progress(user_id, project_id, guide_slug, completed_step_ids, completed_required_count, source)
  VALUES
    (v_owner, NULL,      'capacitor-to-react-native', ARRAY['intro','setup'], 2, 'docs'),
    (v_owner, v_project, 'capacitor-to-react-native', ARRAY['intro'],         1, 'docs');

  -- ── Owner: can see both rows via RLS ────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM public.migration_progress;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'owner expected 2 rows, got %', v_count;
  END IF;

  -- ── Project member (admin): can read project-scoped row, NOT account-scoped
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT count(*) INTO v_count
    FROM public.migration_progress
   WHERE project_id = v_project;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'admin should read 1 project-scoped row, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.migration_progress
   WHERE project_id IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'admin must not read account-scoped progress of other users, got %', v_count;
  END IF;

  -- Admin tries to mark the owner's row complete on their behalf — must fail.
  BEGIN
    UPDATE public.migration_progress
       SET completed_step_ids = ARRAY['intro','setup','verify']
     WHERE user_id = v_owner AND project_id = v_project;
    -- UPDATE under RLS returns 0 rows on policy filter (silent), but a
    -- successful update would be 1+. Either case "succeeded" — assert that
    -- the underlying row is unchanged by re-reading as service role below.
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  -- ── Viewer: same expectations as admin (read project, no write) ─────────
  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  SELECT count(*) INTO v_count
    FROM public.migration_progress
   WHERE project_id = v_project;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'viewer should read 1 project-scoped row, got %', v_count;
  END IF;

  -- ── Outsider: sees nothing (neither account- nor project-scoped) ────────
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  SELECT count(*) INTO v_count FROM public.migration_progress;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'outsider must see no migration_progress rows, got %', v_count;
  END IF;

  -- Outsider attempting to insert a project-scoped row for themselves under
  -- a project they don't belong to must be blocked by the WITH CHECK clause.
  BEGIN
    INSERT INTO public.migration_progress(user_id, project_id, guide_slug, completed_step_ids)
    VALUES (v_outsider, v_project, 'cordova-to-capacitor', ARRAY['intro']);
    RAISE EXCEPTION 'outsider INSERT for non-member project should have failed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN check_violation THEN
      NULL;
  END;

  -- ── Re-read as service role (bypass RLS) to confirm tampering attempts
  --    above did not actually mutate the row owners can see. ───────────────
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_count
    FROM public.migration_progress
   WHERE user_id = v_owner
     AND project_id = v_project
     AND array_length(completed_step_ids, 1) = 1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'owner project-scoped row was tampered with by another user; expected length=1, got count=%', v_count;
  END IF;
END;
$$;

ROLLBACK;
