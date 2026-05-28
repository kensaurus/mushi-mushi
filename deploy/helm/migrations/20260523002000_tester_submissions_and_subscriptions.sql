-- Migration: tester_submissions_and_subscriptions
-- PURPOSE: Wave 1 — tracks which testers have joined which apps and records
--   each individual submission (linked to the existing reports table).

-- ── tester_app_subscriptions ───────────────────────────────────────────────
-- Tracks a tester's membership in a published app's test program.
CREATE TABLE IF NOT EXISTS public.tester_app_subscriptions (
  tester_id             uuid        NOT NULL REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  app_id                uuid        NOT NULL REFERENCES public.published_apps(id) ON DELETE CASCADE,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  left_at               timestamptz,
  agreed_to_app_terms_at timestamptz,
  status                text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'removed', 'banned')),
  PRIMARY KEY (tester_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_tester_subs_app
  ON public.tester_app_subscriptions (app_id, status);

CREATE INDEX IF NOT EXISTS idx_tester_subs_tester
  ON public.tester_app_subscriptions (tester_id, status);

ALTER TABLE public.tester_app_subscriptions ENABLE ROW LEVEL SECURITY;

-- Testers can read/update their own subscriptions.
CREATE POLICY tester_subs_self ON public.tester_app_subscriptions
  FOR ALL TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()))
  WITH CHECK (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

-- Org admins can read (for their published apps) and update status (to ban/remove).
CREATE POLICY tester_subs_org_admin ON public.tester_app_subscriptions
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM public.published_apps pa
      WHERE private.has_org_role(pa.organization_id, ARRAY['owner', 'admin'])
    )
  );

-- ── tester_submissions ─────────────────────────────────────────────────────
-- Each submission links a tester to a report (ingestReport output) and
-- tracks the review lifecycle (pending → accepted / duplicate / etc.).
CREATE TABLE IF NOT EXISTS public.tester_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tester_id           uuid        NOT NULL REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  app_id              uuid        NOT NULL REFERENCES public.published_apps(id) ON DELETE CASCADE,
  -- report_id links to the existing `reports` table (ingested via ingestReport()).
  -- Nullable briefly between ingest and back-patch; non-null within seconds.
  report_id           uuid        REFERENCES public.reports(id) ON DELETE SET NULL,
  submission_type     text        NOT NULL DEFAULT 'bug'
                        CHECK (submission_type IN (
                          'bug', 'feature', 'accessibility', 'content',
                          'localization', 'other'
                        )),
  severity            text        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  status              text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'triaged', 'accepted',
                          'duplicate', 'informative', 'spam', 'withdrawn'
                        )),
  triaged_at          timestamptz,
  accepted_at         timestamptz,
  points_awarded      int         NOT NULL DEFAULT 0 CHECK (points_awarded >= 0),
  reviewer_user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Sentry linkage (same column semantics as reports.sentry_*).
  sentry_event_id     text,
  sentry_issue_url    text,
  sentry_replay_id    text,
  -- Seer analysis blob when auto_seer_analyze=true on the parent published_app.
  sentry_seer_analysis jsonb,
  notes               text        CHECK (length(notes) <= 2000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER tester_submissions_updated_at
  BEFORE UPDATE ON public.tester_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tester_sub_tester
  ON public.tester_submissions (tester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tester_sub_app
  ON public.tester_submissions (app_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tester_sub_report
  ON public.tester_submissions (report_id)
  WHERE report_id IS NOT NULL;

ALTER TABLE public.tester_submissions ENABLE ROW LEVEL SECURITY;

-- Testers can read their own submissions (any status).
CREATE POLICY tester_submissions_self_read ON public.tester_submissions
  FOR SELECT TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

-- Service role (API routes) can insert and update.
-- Org admins can read + update submissions for their apps.
CREATE POLICY tester_submissions_org_admin ON public.tester_submissions
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM public.published_apps pa
      WHERE private.has_org_role(pa.organization_id, ARRAY['owner', 'admin', 'member'])
    )
  );

COMMENT ON TABLE public.tester_submissions IS
  'Each row is one tester submission. Linked to the reports table via report_id. '
  'The review lifecycle (pending → accepted / duplicate / informative / spam) '
  'drives the reputation scoring and points credit in tester_credit_ledger.';

-- Add tester_submission_id to realtime publication so tester dashboard updates live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tester_submissions;
