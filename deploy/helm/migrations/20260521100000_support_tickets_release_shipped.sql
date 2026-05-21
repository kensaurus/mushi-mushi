-- ============================================================
-- Support tickets ↔ releases — closed-loop for admin feedback.
--
-- Operators can mark a bug/feature ticket as shipped in a published
-- release so reporters see "Shipped in v1.2.0" on /feedback.
-- ============================================================

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS shipped_in_release_id UUID
    REFERENCES public.releases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_note TEXT;

COMMENT ON COLUMN public.support_tickets.shipped_in_release_id IS
  'Published release that fulfilled this ticket. Set by operator on triage or auto-stamped on release publish.';
COMMENT ON COLUMN public.support_tickets.shipped_at IS
  'When the ticket was linked to a release (usually matches release.published_at).';
COMMENT ON COLUMN public.support_tickets.shipped_note IS
  'Short customer-visible note (e.g. "Fixed in dashboard refresh"). Shown on /feedback.';

CREATE INDEX IF NOT EXISTS idx_support_tickets_shipped_release
  ON public.support_tickets (shipped_in_release_id)
  WHERE shipped_in_release_id IS NOT NULL;

-- Optional bulk link from release publish flow
ALTER TABLE public.releases
  ADD COLUMN IF NOT EXISTS fulfilled_ticket_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.releases.fulfilled_ticket_ids IS
  'Admin support_ticket ids credited in this release. On publish, tickets get shipped_in_release_id stamped.';
