-- ============================================================
-- Teams v1.3 — auto-create a personal organization on signup.
--
-- WHY
-- ---
-- The Teams v1 rollout (20260428000200_organization_backfill) created a
-- personal org for every user who already owned a project. New signups
-- that arrive AFTER that backfill have no path to a writable org:
--
--   • POST /v1/admin/projects requires the caller to be owner/admin of
--     SOME organization. With no membership row at all, the endpoint
--     short-circuits with `NO_ORGANIZATION` and the user sees
--     "Failed to create project — You need to be an owner or admin of
--     an organization to create a project" on the very first thing they
--     try to do after signing up. Dead end.
--
--   • OrgSwitcher returns `null` when the user has zero memberships, so
--     the "+ New team" affordance isn't even visible — there is no
--     in-product way to recover.
--
-- This migration plugs the gap with the canonical Supabase pattern:
-- a SECURITY DEFINER trigger on `auth.users` that materialises one
-- personal organization + owner membership per new user. Plus a
-- one-shot backfill for every existing user who slipped through.
--
-- SAFETY
-- ------
-- Supabase's own docs are explicit: "Test thoroughly as trigger failures
-- can block signups." (auth/managing-user-data.mdx). We bend over
-- backwards here to make the trigger non-fatal:
--
--   1. EXCEPTION block catches anything → logs a NOTICE and returns NEW
--      so the signup still completes.
--   2. The route layer (POST /v1/admin/projects) has a lazy-bootstrap
--      fallback that calls bootstrap_personal_org() if memberships are
--      empty. Trigger failure → user signs up fine → first project
--      create still works via the fallback. Two independent paths.
--
-- IDEMPOTENCY
-- -----------
-- Every step is re-runnable:
--   • `bootstrap_personal_org(uuid)` returns the existing personal org
--     when the user already owns one.
--   • Slug collisions retry with a random tail.
--   • The trigger CREATE has DROP-IF-EXISTS in front of it.
--   • The backfill SELECTs only users without a personal org they own.
-- ============================================================

-- ------------------------------------------------------------
-- bootstrap_personal_org(uuid) — idempotent factory.
--
-- Returns the user's personal organization id. If one already exists
-- (is_personal=true, owner_id matches), returns it; otherwise creates
-- both the org and the owner membership row in a single function call
-- so callers don't have to reproduce the slug-uniqueness dance.
--
-- Lives in `private` because it's an implementation detail of the
-- signup trigger + edge-function lazy fallback. Service-role only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bootstrap_personal_org(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing uuid;
  v_org_id   uuid;
  v_slug     text;
  v_attempt  int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_personal_org: user_id required'
      USING errcode = 'P0001';
  END IF;

  -- Already has a personal org they own? Return it. The (is_personal,
  -- owner_id) pair is the canonical "this is your workspace" signal
  -- used by the rest of the system, so we honor the same shape here.
  SELECT id INTO v_existing
  FROM public.organizations
  WHERE owner_id = p_user_id
    AND is_personal = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Defensive: make sure the membership row exists too. A migration
    -- gap once produced personal orgs without an owner row, locking
    -- the user out of their own workspace (RLS only surfaces orgs the
    -- caller is a member of). Heal that on the spot.
    INSERT INTO public.organization_members(
      organization_id, user_id, role, joined_via, last_active_at
    )
    VALUES (v_existing, p_user_id, 'owner', 'personal_backfill', now())
    ON CONFLICT (organization_id, user_id)
    DO UPDATE SET role = 'owner', updated_at = now();
    RETURN v_existing;
  END IF;

  -- Match the slug shape the v1 backfill used: `personal-<8 hex>`. A
  -- collision is vanishingly unlikely for distinct user ids (UUID v4
  -- prefix), but Postgres still enforces the UNIQUE constraint, so we
  -- retry with a random tail just in case.
  v_slug := 'personal-' || substr(p_user_id::text, 1, 8);

  LOOP
    BEGIN
      INSERT INTO public.organizations (slug, name, owner_id, plan_id, is_personal)
      VALUES (v_slug, 'Personal workspace', p_user_id, 'hobby', true)
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        v_attempt := v_attempt + 1;
        IF v_attempt > 5 THEN
          RAISE EXCEPTION 'bootstrap_personal_org: slug allocation failed for %', p_user_id
            USING errcode = 'P0001';
        END IF;
        -- 4 random hex chars keep the slug under the 64-char cap with
        -- room to spare and avoid the leading/trailing-dash check.
        v_slug := 'personal-' || substr(p_user_id::text, 1, 8) || '-'
                  || lpad(to_hex((random() * 65535)::int), 4, '0');
    END;
  END LOOP;

  -- Founding membership: owner role + provenance label that the roster
  -- UI maps to "this is your personal workspace" and hides from the
  -- normal team-roster pills.
  INSERT INTO public.organization_members (
    organization_id, user_id, role, joined_via, last_active_at
  )
  VALUES (v_org_id, p_user_id, 'owner', 'personal_backfill', now())
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = 'owner', updated_at = now();

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION private.bootstrap_personal_org(uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.bootstrap_personal_org(uuid) TO service_role;

COMMENT ON FUNCTION private.bootstrap_personal_org(uuid) IS
  'Idempotent factory that returns the user''s personal organization id, creating both the org and the owner membership row if missing. Called by the on_auth_user_created_personal_org trigger and by the POST /v1/admin/projects fallback in the api edge function. Safe to call repeatedly.';

-- ------------------------------------------------------------
-- handle_new_user_personal_org() — signup trigger function.
--
-- Wraps bootstrap_personal_org() in an EXCEPTION block so a failure
-- (constraint regression, slug exhaustion, anything) NEVER blocks the
-- underlying auth.users INSERT. The Supabase docs are emphatic about
-- this — a throwing trigger here breaks signup for every new user.
-- We log via RAISE NOTICE so the failure shows up in Postgres logs
-- and `get_logs(service: 'postgres')` for triage.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_personal_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.bootstrap_personal_org(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'handle_new_user_personal_org: failed for user %: % (%)',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_personal_org() FROM public;
GRANT EXECUTE ON FUNCTION public.handle_new_user_personal_org() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.handle_new_user_personal_org() TO service_role;

COMMENT ON FUNCTION public.handle_new_user_personal_org() IS
  'AFTER INSERT trigger on auth.users that materialises one personal organization + owner membership per new signup. Exceptions are swallowed so a trigger failure cannot block signup; the api edge function''s lazy fallback covers any user whose trigger run failed.';

DROP TRIGGER IF EXISTS on_auth_user_created_personal_org ON auth.users;
CREATE TRIGGER on_auth_user_created_personal_org
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_personal_org();

-- ------------------------------------------------------------
-- Backfill — every existing user without a personal org they own.
--
-- Mirrors the original Teams v1 backfill but is keyed by the user
-- table directly (not "users who own a project") so we catch the
-- two failure modes the v1 backfill missed:
--   1. Brand-new signups since the v1 backfill ran.
--   2. Users who created an account but never created a project,
--      so the v1 backfill's WHERE owner_id IS NOT NULL skipped them.
--
-- Done in pure SQL so the backfill is atomic and re-runnable.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT u.id AS user_id
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.owner_id = u.id
        AND o.is_personal = true
    )
  LOOP
    BEGIN
      PERFORM private.bootstrap_personal_org(r.user_id);
    EXCEPTION WHEN OTHERS THEN
      -- One bad row shouldn't stop the rest of the backfill. Log and
      -- continue; the fallback path will catch it later.
      RAISE NOTICE 'bootstrap_personal_org backfill: failed for user %: % (%)',
        r.user_id, SQLERRM, SQLSTATE;
    END;
  END LOOP;
END;
$$;
