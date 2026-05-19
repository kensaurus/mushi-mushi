-- ============================================================================
-- 20260510010000_a2a_push_notifications.sql
--
-- A2A v1.0.0 PushNotificationConfig support
-- =============================================================================
-- The Tasks resource family advertised at `/v1/a2a/tasks` already supports
-- pull-mode subscriptions via SSE (`GET /v1/a2a/tasks/:id:subscribe`). This
-- migration adds the *push* counterpart so external orchestrators
-- (LangGraph / CrewAI / OpenAI Agents SDK) can register a callback URL at
-- task creation and receive HMAC-signed POSTs whenever the task's state
-- transitions — without having to hold a long-lived SSE connection open.
--
-- Wire-up
-- -------
--   1. POST /v1/a2a/tasks accepts body.configuration.pushNotificationConfig
--      and persists it on the new column.
--   2. AFTER UPDATE OF status trigger calls
--      `net.http_post('<edge>/a2a-push-notify', { taskId })`.
--   3. The `a2a-push-notify` edge function reads the row, builds the A2A
--      Task envelope, signs with Standard Webhooks headers, and POSTs.
--
-- Schema
-- ------
--   push_notification_config JSONB shape:
--     {
--       "url":   "https://orchestrator.example.com/a2a/callback",
--       "token": "optional bearer (sent as Authorization: Bearer <token>)"
--     }
--
-- We intentionally avoid storing arbitrary auth.credentials beyond a bearer
-- token in this iteration — anything more (mTLS, OAuth client_credentials)
-- routes through the existing project_plugins surface where Vault-backed
-- secret refs already exist.
-- ============================================================================

ALTER TABLE public.fix_dispatch_jobs
  ADD COLUMN IF NOT EXISTS push_notification_config JSONB;

COMMENT ON COLUMN public.fix_dispatch_jobs.push_notification_config IS
  'A2A v1.0.0 PushNotificationConfig: { url, token? }. When non-NULL, the trigger fn_a2a_push_on_status_change posts the task update to url with Standard Webhooks headers.';

-- ----------------------------------------------------------------------------
-- Trigger function: fires for every status transition on fix_dispatch_jobs
-- when push_notification_config is configured.
--
-- Uses pg_net so the HTTP call is async (~5 ms enqueue) — no risk of holding
-- a transaction open on a flaky downstream URL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_a2a_push_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key  TEXT;
  v_request_id   BIGINT;
BEGIN
  IF NEW.push_notification_config IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Read project secrets from supabase_vault. We require both the URL
  -- (so the function knows where to call itself) and the service role key
  -- (so the called edge function can read the row back). If either is
  -- missing we silently skip — the trigger must never break a status
  -- update because notification plumbing is unconfigured.
  BEGIN
    v_supabase_url := current_setting('app.settings.supabase_url', true);
    v_service_key  := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN others THEN
    v_supabase_url := NULL;
    v_service_key  := NULL;
  END;

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- net.http_post is non-blocking; the response lands in net._http_response
  -- and is reaped automatically. We only care that the POST got queued.
  SELECT net.http_post(
    url     := v_supabase_url || '/functions/v1/a2a-push-notify',
    body    := jsonb_build_object('taskId', NEW.id, 'newStatus', NEW.status, 'previousStatus', OLD.status),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_service_key
               ),
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fix_dispatch_jobs_a2a_push ON public.fix_dispatch_jobs;
CREATE TRIGGER trg_fix_dispatch_jobs_a2a_push
  AFTER UPDATE OF status ON public.fix_dispatch_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_a2a_push_on_status_change();

-- ----------------------------------------------------------------------------
-- Audit log table: every push attempt (success or failure) lands here so
-- operators can debug callback delivery without grepping pg_net response
-- rows. Mirrors the shape of plugin_dispatch_log on purpose so the admin UI
-- can reuse the same table component.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.a2a_push_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES public.fix_dispatch_jobs(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  delivery_id     UUID NOT NULL,
  callback_url    TEXT NOT NULL,
  task_state      TEXT NOT NULL,
  http_status     INTEGER,
  duration_ms     INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'skipped')),
  response_excerpt TEXT,
  attempt         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_a2a_push_deliveries_task ON public.a2a_push_deliveries(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2a_push_deliveries_project ON public.a2a_push_deliveries(project_id, created_at DESC);

ALTER TABLE public.a2a_push_deliveries ENABLE ROW LEVEL SECURITY;

-- Project members see their own deliveries; service role bypasses RLS for
-- the edge function inserts.
CREATE POLICY a2a_push_deliveries_project_read ON public.a2a_push_deliveries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = a2a_push_deliveries.project_id
        AND pm.user_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE public.a2a_push_deliveries IS
  'Audit log of A2A v1.0.0 PushNotificationConfig deliveries. Service role inserts; project members read their own rows via RLS.';
