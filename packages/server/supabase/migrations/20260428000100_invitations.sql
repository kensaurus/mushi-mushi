-- ============================================================
-- Teams v1: invitations + accept RPC + server-side plan/owner guards.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  -- Postgres' encode() does not understand 'base64url', only 'base64'/'hex'/
  -- 'escape', so we base64-encode and translate the URL-unsafe chars
  -- ourselves. 24 random bytes -> 32 url-safe chars after stripping '='.
  token text NOT NULL UNIQUE DEFAULT replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation_email
  ON public.invitations(organization_id, lower(email::text))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_org_created
  ON public.invitations(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_token_active
  ON public.invitations(token)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_invitation_plan_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan text;
  v_enabled boolean;
BEGIN
  SELECT o.plan_id, COALESCE((pp.feature_flags ->> 'teams')::boolean, o.plan_id IN ('pro', 'enterprise'))
    INTO v_plan, v_enabled
  FROM public.organizations o
  LEFT JOIN public.pricing_plans pp ON pp.id = o.plan_id
  WHERE o.id = NEW.organization_id;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'organization_not_found' USING errcode = 'P0001';
  END IF;

  IF v_plan NOT IN ('pro', 'enterprise') OR NOT v_enabled THEN
    RAISE EXCEPTION 'feature_not_in_plan: Teams requires Pro or Enterprise (current: %)', v_plan
      USING errcode = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_plan_gate ON public.invitations;
CREATE TRIGGER invitations_plan_gate
  BEFORE INSERT ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invitation_plan_gate();

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_email text;
BEGIN
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = 'P0001';
  END IF;

  SELECT *
    INTO v_inv
  FROM public.invitations
  WHERE token = p_token
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_invalid_or_expired' USING errcode = 'P0001';
  END IF;

  IF lower(v_inv.email::text) <> lower(v_email) THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING errcode = 'P0001';
  END IF;

  INSERT INTO public.organization_members(organization_id, user_id, role, invited_by)
  VALUES (v_inv.organization_id, auth.uid(), v_inv.role, v_inv.invited_by)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    invited_by = EXCLUDED.invited_by,
    updated_at = now();

  UPDATE public.invitations
  SET accepted_at = now(), accepted_by = auth.uid()
  WHERE id = v_inv.id;

  RETURN v_inv.organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_last_organization_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner_count int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner')
    OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner') THEN
    SELECT count(*)
      INTO v_owner_count
    FROM public.organization_members
    WHERE organization_id = OLD.organization_id
      AND role = 'owner';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'cannot_remove_last_owner' USING errcode = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS om_last_owner ON public.organization_members;
CREATE TRIGGER om_last_owner
  BEFORE UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_last_organization_owner();

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_read_admin ON public.invitations;
CREATE POLICY invitations_read_admin ON public.invitations
  FOR SELECT TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS invitations_insert_admin ON public.invitations;
CREATE POLICY invitations_insert_admin ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = (SELECT auth.uid())
    AND private.has_org_role(organization_id, ARRAY['owner','admin'])
  );

DROP POLICY IF EXISTS invitations_revoke_admin ON public.invitations;
CREATE POLICY invitations_revoke_admin ON public.invitations
  FOR UPDATE TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['owner','admin']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner','admin']));

COMMENT ON TABLE public.invitations IS
  'Pending team invitations scoped to an organization. Accepted atomically through public.accept_invitation(token).';
COMMENT ON FUNCTION public.accept_invitation(text) IS
  'Accepts an invitation for the currently authenticated Supabase user. Locks the invite row and verifies email before adding membership.';
