-- ============================================================
-- Support tickets v2 — customer-side cancel + admin reply.
--
-- Why now: the customer-facing /billing UI gained a clickable ticket
-- detail modal. Two gaps the v1 schema couldn't cover:
--
--   1. Customers had no way to retract a ticket they'd opened by
--      mistake or solved themselves. Operators were closing those
--      manually with `status = 'closed'`, which loses the "user
--      cancelled it" signal in the history view.
--
--   2. There was nowhere to put an admin's reply that the customer
--      should READ. `operator_notes` is documented as
--      "NEVER sent back to the customer", so reusing it would be a
--      privacy footgun. We add a separate `admin_response` column
--      whose RLS already permits the reporter to read.
-- ============================================================

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_status_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'cancelled'));

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS admin_response TEXT,
  ADD COLUMN IF NOT EXISTS admin_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.support_tickets.admin_response IS
  'Operator reply visible to the reporter (rendered in the customer ticket detail modal). Distinct from operator_notes which is internal-only.';
COMMENT ON COLUMN public.support_tickets.admin_responded_at IS
  'Timestamp the operator last updated admin_response. Used to surface "replied · 2h ago" in the customer UI.';
COMMENT ON COLUMN public.support_tickets.cancelled_at IS
  'Timestamp the customer cancelled the ticket via /v1/admin/support/tickets/:id/cancel.';

-- Refresh the trigger so a flip to status='cancelled' stamps cancelled_at
-- exactly once, in the same way 'resolved'/'closed' stamp resolved_at.
CREATE OR REPLACE FUNCTION set_support_tickets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status IN ('resolved', 'closed')
     AND OLD.status NOT IN ('resolved', 'closed')
     AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at = now();
  END IF;
  IF NEW.status = 'cancelled'
     AND OLD.status <> 'cancelled'
     AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at = now();
  END IF;
  RETURN NEW;
END
$$;
