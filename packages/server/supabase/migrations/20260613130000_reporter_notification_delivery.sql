-- ============================================================================
-- 20260613130000_reporter_notification_delivery.sql
--
-- Multi-channel notification fan-out with idempotent delivery ledger.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reporter_notification_prefs (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reporter_token_hash text NOT NULL,
  channels jsonb NOT NULL DEFAULT '{"in_app": true, "email": false, "push": false}'::jsonb,
  notification_email text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, reporter_token_hash)
);

ALTER TABLE public.reporter_notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reporter_notification_prefs_deny_all ON public.reporter_notification_prefs;
CREATE POLICY reporter_notification_prefs_deny_all ON public.reporter_notification_prefs
  AS RESTRICTIVE FOR ALL
  USING (false);

COMMENT ON TABLE public.reporter_notification_prefs IS
  'Per-reporter channel opt-in. Service-role only; email is opt-in from the SDK widget.';

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  reporter_token_hash text NOT NULL,
  notification_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  attempts int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, notification_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_project_status
  ON public.notification_deliveries(project_id, status, created_at DESC);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_deliveries_deny_all ON public.notification_deliveries;
CREATE POLICY notification_deliveries_deny_all ON public.notification_deliveries
  AS RESTRICTIVE FOR ALL
  USING (false);

COMMENT ON TABLE public.notification_deliveries IS
  'Idempotent delivery ledger — one row per (report, type, channel). Retries bump attempts; failures are logged, never thrown.';
