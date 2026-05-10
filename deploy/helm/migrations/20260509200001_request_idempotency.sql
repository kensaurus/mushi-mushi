-- 20260509200001_request_idempotency.sql
--
-- Implements the Idempotency-Key HTTP header pattern (IETF draft) for
-- all Mushi mutation endpoints.
--
-- How it works:
--   1. Client sends `Idempotency-Key: <uuid>` on a mutation request.
--   2. Middleware computes SHA-256(request body) as the request hash.
--   3. On first request: insert row, run handler, store response.
--   4. On retry with same key + same body: replay stored response,
--      add `Idempotency-Replayed: true` header.
--   5. On retry with same key but DIFFERENT body: return 409
--      IDEMPOTENCY_KEY_REUSED — prevents accidental body mutation.
--   6. Cleanup: pg_cron purges rows older than 24h.
--
-- Applied to:
--   POST /v1/admin/fixes/dispatch
--   POST /v1/a2a/tasks
--   POST /v1/admin/inventory/:projectId/proposals/:id/accept
--   POST /v1/admin/inventory/:projectId/gates/run
--   POST /v1/admin/projects/:id/keys/rotate
--   POST /v1/reports
--   POST /v1/reports/batch
--

-- Tenancy: cache is scoped by the AUTHENTICATED user_id (set by auth
-- middleware), not by a body-supplied projectId. Without this, a logged-in
-- user B could spoof projectId=P_A in the request body, trigger a 403
-- handler, and seed (P_A, key) with a 403 response — DoS'ing the legitimate
-- owner of P_A on their next retry with the same Idempotency-Key.
-- project_id is retained as a column for audit/cleanup but is NOT in the
-- cache key.
CREATE TABLE IF NOT EXISTS public.request_idempotency (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key           text        NOT NULL,
  project_id    uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  request_hash  text        NOT NULL,  -- SHA-256 hex of the request body
  response_status integer   NOT NULL,
  response_body  jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, key)
);

-- Fast 24h expiry sweep (pg_cron job below). A plain btree on `created_at`
-- is enough — Postgres rejects partial-index predicates that depend on
-- volatile/stable functions like now(), so we cannot pre-filter to "older
-- than 24h" at the index level. The full btree is small (24h of writes).
CREATE INDEX IF NOT EXISTS idx_request_idempotency_created_at
  ON public.request_idempotency(created_at);

-- Project-scoped audit reads (`/v1/admin/idempotency/audit`) stay fast.
CREATE INDEX IF NOT EXISTS idx_request_idempotency_project_user
  ON public.request_idempotency(project_id, user_id);

ALTER TABLE public.request_idempotency ENABLE ROW LEVEL SECURITY;

-- Service role has full access (Edge Functions use service role).
CREATE POLICY "service role full access"
  ON public.request_idempotency
  FOR ALL
  USING       ((SELECT auth.role()) = 'service_role')
  WITH CHECK  ((SELECT auth.role()) = 'service_role');

-- Project members can read their own idempotency records (audit / debug).
CREATE POLICY "members read own project"
  ON public.request_idempotency
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

-- Cleanup function called by pg_cron (see cron schedule below).
CREATE OR REPLACE FUNCTION public.cleanup_idempotency_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.request_idempotency
  WHERE created_at < now() - INTERVAL '24 hours';
$$;

-- Register the daily cleanup job if pg_cron is available.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'mushi-idempotency-cleanup',
      '0 * * * *',  -- every hour (rows expire after 24h, sweep hourly for low bloat)
      'SELECT public.cleanup_idempotency_keys()'
    );
  END IF;
END $$;
