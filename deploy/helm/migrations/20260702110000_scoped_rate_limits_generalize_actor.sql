-- 20260702110000_scoped_rate_limits_generalize_actor.sql
--
-- Generalizes `scoped_rate_limits.user_id` from a strict auth.users FK to an
-- opaque actor identifier, and fixes a live production bug this surfaced.
--
-- BUG FOUND (production-readiness audit, cli-device-auth-ratelimit item):
--   20260612000000_report_ingest_burst_rate_limit.sql added
--   `report_ingest_rate_limit_claim(p_project_id, ...)`, which calls
--   `scoped_rate_limit_claim(p_project_id, 'report_ingest', ...)` — passing a
--   PROJECT id into a column that carries
--   `FOREIGN KEY (user_id) REFERENCES auth.users(id)`. Every single call
--   raises a 23503 foreign-key-violation (confirmed live against this
--   project: any project_id that isn't coincidentally also a row in
--   auth.users fails the INSERT). The three call sites
--   (POST /v1/reports[/batch], /v1/ingest/spans, /v1/ingest/metrics) all
--   catch the RPC error, check only for the literal string
--   'rate_limit_exceeded', and treat anything else — including this FK
--   violation — as "non-fatal, let the request through". Net effect: the
--   report/span/metric ingest burst-rate-limit has been silently disabled
--   for every project since it shipped; the SDK-key-leak DDoS protection
--   the migration's own docstring promises was never actually active.
--
-- FIX: drop the FK. The column was already being used as a generic
-- "rate-limit actor" bucket (real user ids for `claimRateLimit`-style call
-- sites, project ids for report-ingest) — the FK just silently rejected the
-- non-user case instead of erroring loudly, and today's cli-device-auth-
-- ratelimit work needs a THIRD actor shape (a deterministic pseudo-UUID
-- derived from the caller's IP for the two unauthenticated
-- /v1/cli/auth/device/{start,token} endpoints, which have no user_id at
-- all). Losing `ON DELETE CASCADE` for real users is a non-issue: rows are
-- already swept by the existing `scoped_rate_limit_prune()` cron regardless
-- of whether the referenced user still exists.
--
-- No RLS change needed: the existing "scoped_rate_limits_self_read" policy
-- (`auth.uid() = user_id`) simply never matches for project-id or
-- ip-derived rows, which is the correct behavior (nobody should be able to
-- read another actor's rate-limit bucket via that policy anyway).

ALTER TABLE public.scoped_rate_limits
  DROP CONSTRAINT IF EXISTS scoped_rate_limits_user_id_fkey;

COMMENT ON COLUMN public.scoped_rate_limits.user_id IS
  'Opaque rate-limit actor id — NOT always a real auth.users id. May be a '
  'real user id (claimRateLimit call sites), a project id '
  '(report_ingest_rate_limit_claim), or a deterministic SHA-256-derived '
  'pseudo-UUID keyed on caller IP (unauthenticated CLI device-auth '
  'endpoints). The FK to auth.users was dropped 2026-07-02 after it was '
  'found to silently break report-ingest rate limiting in production — see '
  '20260702110000_scoped_rate_limits_generalize_actor.sql.';
