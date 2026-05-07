-- ============================================================
-- Invitations v1.1 — capture WHO cancelled an invite, not just WHEN.
--
-- Why now: the admin Members page just gained a customer-facing "Cancel
-- invite" affordance with optimistic undo. Without `revoked_by` we can
-- only tell that *somebody* on the org's owner/admin set killed the
-- invite — not which teammate. That's fine for a 2-person team and
-- terrible for a 30-person org where two admins are independently
-- triaging the pending list.
--
-- Pairs nicely with the existing `revoked_at` (timestamp) and
-- `accepted_by` (audit of acceptor) columns, which together give us a
-- full "who did what when" audit trail for every invitation row
-- without joining anywhere else.
--
-- `last_resent_at` is added at the same time so that a future "Resend
-- invite" affordance (or the existing inviteUserByEmail retry path)
-- can surface "Resent · 2h ago" inline without needing another
-- migration. Cheap, additive, no NOT NULL — safe for prod.
-- ============================================================

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_resent_at timestamptz;

-- A revocation must be a closed pair: either both stamps are present
-- or neither is. Prevents accidental writes that set `revoked_by`
-- without `revoked_at` (would silently break "is this invite still
-- pending?" queries that key off `revoked_at IS NULL`).
ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_revocation_pair_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_revocation_pair_check
  CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL)
  );

COMMENT ON COLUMN public.invitations.revoked_by IS
  'auth.users.id of the owner/admin who revoked the invite. NULL when the row has not been revoked, or when the revoker has since been deleted from auth.users.';
COMMENT ON COLUMN public.invitations.last_resent_at IS
  'Most recent timestamp at which Supabase auth.admin.inviteUserByEmail was retried for this row. Used by the Members page to render "Resent · 2h ago" alongside the original Sent timestamp.';
