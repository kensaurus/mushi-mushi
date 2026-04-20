-- ============================================================
-- Support inbox — paid customers submit tickets from the admin
-- console; the operator gets pushed via OPERATOR_*_WEBHOOK_URL and
-- can browse the queue in the audit log + a future /v1/admin/support
-- dashboard.
--
-- Why a DB row at all (vs just emailing the operator)?
--   1. Searchable history per project — "what did Acme report last week?"
--   2. Rate-limit / abuse defence: we count tickets per (user, hour).
--   3. Survives Slack/Discord outages — webhook delivery is best-effort.
--   4. Lets us flip a ticket to status='resolved' from the admin UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  -- Reporter is the auth.users.id of the admin who submitted the form.
  -- NULL is allowed only for self-hosted forks that pre-date auth.
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      TEXT NOT NULL,
  subject         TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 10 AND 5000),
  -- 'billing' | 'bug' | 'feature' | 'other' — bound by the form's <select>.
  category        TEXT NOT NULL DEFAULT 'other',
  -- Plan tier at the moment of submission, captured for triage SLA.
  -- NULL = free tier; otherwise mirrors pricing_plans.id.
  plan_id         TEXT REFERENCES pricing_plans(id),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  -- Operator's free-form internal note. NEVER sent back to the customer.
  operator_notes  TEXT,
  -- Whether the operator-notify push to Slack/Discord succeeded. Used by
  -- a backfill cron so we can retry pushes that fell on the floor when the
  -- webhook URL was misconfigured / expired.
  notified_at     TIMESTAMPTZ,
  -- Best-effort client metadata for triage (no PII beyond the email above).
  user_agent      TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

-- RLS query patterns. Indexed so the per-project + per-status filter is fast
-- once the table grows past a few hundred rows.
CREATE INDEX IF NOT EXISTS idx_support_tickets_project_status
  ON support_tickets (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_open
  ON support_tickets (created_at DESC)
  WHERE status = 'open';

-- updated_at auto-bump. Reuse the project-wide trigger if it exists, else
-- inline a tiny one. Idempotent.
CREATE OR REPLACE FUNCTION set_support_tickets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  -- When status flips to resolved/closed, stamp resolved_at once.
  IF NEW.status IN ('resolved', 'closed')
     AND OLD.status NOT IN ('resolved', 'closed')
     AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at = now();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_support_tickets_updated_at();

-- ----------------------------------------------------------------
-- RLS — same model as projects: only members of the project can see
-- their own tickets. The service_role (used by the operator-side
-- /v1/admin/support endpoint and the notifier worker) bypasses RLS.
-- ----------------------------------------------------------------
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_owner_read ON support_tickets;
CREATE POLICY support_tickets_owner_read ON support_tickets
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS support_tickets_owner_insert ON support_tickets;
CREATE POLICY support_tickets_owner_insert ON support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      project_id IS NULL
      OR project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- Customers cannot mutate tickets after submission (operator owns triage).
-- Status changes flow through a service_role endpoint, not RLS.

COMMENT ON TABLE support_tickets IS
  'Customer-submitted support tickets from the admin console. Reads are RLS-scoped to the project; writes happen via /v1/support/contact (auth-gated, rate-limited).';
