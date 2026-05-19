-- ============================================================
-- Membership v1.1 — activity tracking + provenance.
--
-- Two intertwined columns that together fix the two questions every
-- B2B admin asks about a teammate row but couldn't answer before:
--
--   1. "When did this person actually do anything in this org?"
--      Without `last_active_at`, a 30-person org has no signal for
--      who's coasting on a paid seat vs who's actively using it.
--      Annual seat audits become "guess based on who's loud in
--      Slack" instead of "sort by last activity, ask the bottom 5%".
--
--   2. "How did this person get here?"
--      `invited_by` answers WHO let them in, not the path. A user who
--      joined an SSO org through IdP provisioning, vs one who was
--      hand-invited, vs the founding owner of the workspace, are
--      legally distinct in audit and security reviews. Stuffing
--      everything into one nullable column meant the audit log had
--      to JOIN three tables to reconstruct a fact that should be
--      one column lookup. `joined_via` captures the path explicitly
--      with a CHECK so a future code path can't quietly invent a
--      fifth value the rest of the system doesn't understand.
--
-- Both columns are additive, NULL-safe, with sensible backfills.
--
-- Backfill strategy for `last_active_at`:
--   Use `created_at` as a baseline. The literal "first time the
--   middleware updates this row" is the more accurate semantic, but
--   leaving the column NULL until then would cause every existing
--   member to render as "Never active" in the roster — false negative
--   on day 1, gradually correcting itself. Backfilling to created_at
--   degrades gracefully: the worst case is "the value is stale by
--   the time-since-join", which the FE already handles via the
--   relative-time formatter ("Active 12d ago" reads honestly even
--   when the actual touch was at signup).
--
-- Backfill strategy for `joined_via`:
--   Personal orgs (`is_personal = true`)        → 'personal_backfill'
--   Org owner of a non-personal org            → 'founding_owner'
--   Member with `invited_by IS NOT NULL`        → 'invitation'
--   Otherwise (rare; legacy direct INSERTs)    → 'direct_admin'
--
-- We classify in this order to handle the personal-orgs-have-owner
-- ambiguity correctly: a personal-org member is BOTH the owner AND
-- self-created, but 'personal_backfill' is the higher-signal label
-- because it tells you the org isn't a real team.
-- ============================================================

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS joined_via     text;

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_joined_via_check;
ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_joined_via_check
  CHECK (
    joined_via IS NULL
    OR joined_via IN ('invitation', 'sso', 'personal_backfill', 'founding_owner', 'direct_admin')
  );

-- Backfill last_active_at — see header comment for rationale.
UPDATE public.organization_members
SET last_active_at = created_at
WHERE last_active_at IS NULL;

-- Backfill joined_via in priority order. Each pass leaves NULL alone
-- so the next pass can claim only the still-unclassified rows.
UPDATE public.organization_members om
SET joined_via = 'personal_backfill'
FROM public.organizations o
WHERE om.organization_id = o.id
  AND o.is_personal = true
  AND om.joined_via IS NULL;

UPDATE public.organization_members om
SET joined_via = 'founding_owner'
FROM public.organizations o
WHERE om.organization_id = o.id
  AND o.is_personal = false
  AND om.user_id = o.owner_id
  AND om.joined_via IS NULL;

UPDATE public.organization_members
SET joined_via = 'invitation'
WHERE invited_by IS NOT NULL
  AND joined_via IS NULL;

UPDATE public.organization_members
SET joined_via = 'direct_admin'
WHERE joined_via IS NULL;

-- Roster sort hot-path: "give me this org's members, most-recently-active
-- first". The DESC NULLS LAST positions never-touched members at the end
-- of the page where they're easy to ignore until the operator cares.
CREATE INDEX IF NOT EXISTS idx_organization_members_org_active
  ON public.organization_members (organization_id, last_active_at DESC NULLS LAST);

COMMENT ON COLUMN public.organization_members.last_active_at IS
  'Most recent timestamp at which this member made an authenticated request to the API while having this org in context. Updated by private.touch_org_member_activity() with a 5-minute coalescing window so a normal user generates ~12 writes/hour, not 12 per second.';
COMMENT ON COLUMN public.organization_members.joined_via IS
  'How this user got access. invitation = accepted a /v1/invitations link. sso = provisioned through SCIM/OIDC (reserved). personal_backfill = auto-created personal-org membership. founding_owner = created the org via /v1/org. direct_admin = direct INSERT, typically from a legacy admin tool.';

-- ============================================================
-- private.touch_org_member_activity — the workhorse the API
-- middleware calls on every authenticated request to keep
-- last_active_at warm without melting the row.
--
-- Coalescing: only writes if the existing stamp is NULL or older
-- than 5 minutes. A normal user generates one write per 5-minute
-- window, regardless of how many API calls they fire. That keeps
-- the index, MVCC pressure, and replication lag bounded for any
-- size of team.
--
-- SECURITY DEFINER so the API can call this through the user-
-- scoped client without granting UPDATE on organization_members
-- to the `authenticated` role broadly. The function only updates
-- a single (org_id, user_id) pair the caller specifies.
-- ============================================================

CREATE OR REPLACE FUNCTION private.touch_org_member_activity(
  p_org_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.organization_members
  SET last_active_at = now()
  WHERE organization_id = p_org_id
    AND user_id = p_user_id
    AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes');
$$;

REVOKE ALL ON FUNCTION private.touch_org_member_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.touch_org_member_activity(uuid, uuid) TO service_role;

COMMENT ON FUNCTION private.touch_org_member_activity(uuid, uuid) IS
  'Coalesced activity touch — writes last_active_at only when the row is stale by ≥ 5 minutes. Called fire-and-forget from the api edge function''s jwtAuth middleware; never blocks the request path. Service-role only so the auth boundary stays clean.';

-- ============================================================
-- Update accept_invitation to stamp joined_via='invitation' on the
-- membership row it materialises. Without this, every accept after
-- this migration creates a member row with joined_via NULL — the
-- backfill above only touches existing rows.
-- ============================================================
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

  INSERT INTO public.organization_members(
    organization_id, user_id, role, invited_by, joined_via, last_active_at
  )
  VALUES (
    v_inv.organization_id, auth.uid(), v_inv.role, v_inv.invited_by, 'invitation', now()
  )
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    invited_by = EXCLUDED.invited_by,
    -- joined_via is intentionally NOT overwritten on conflict: a user
    -- who was previously a 'founding_owner' shouldn't be downgraded
    -- to 'invitation' just because they accepted a re-invite. Keep
    -- the original provenance unless it was NULL (legacy row).
    joined_via = COALESCE(public.organization_members.joined_via, EXCLUDED.joined_via),
    last_active_at = now(),
    updated_at = now();

  UPDATE public.invitations
  SET accepted_at = now(), accepted_by = auth.uid()
  WHERE id = v_inv.id;

  RETURN v_inv.organization_id;
END;
$$;

COMMENT ON FUNCTION public.accept_invitation(text) IS
  'Accepts an invitation for the currently authenticated Supabase user. Locks the invite row, verifies email, materialises the organization_members row with joined_via=invitation, and stamps last_active_at = now() so the new member shows up fresh in the roster.';
