-- Console / SDK / CLI / MCP enhancement (Jun 15 2026)
-- Replay gate, autofix budget caps, public roadmap anon read, push subscriptions, prompt canary.

-- ── SDK replay capture gate ─────────────────────────────────────────────────
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS sdk_capture_replay boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN project_settings.sdk_capture_replay IS
  'When true, SDK may attach rrweb rolling-buffer events on report submit (maskAllInputs enforced client-side).';

-- ── Auto-fix spend / dispatch governance ────────────────────────────────────
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS autofix_max_spend_usd numeric(10,4),
  ADD COLUMN IF NOT EXISTS autofix_max_dispatches_per_day int,
  ADD COLUMN IF NOT EXISTS autofix_approval_cost_threshold_usd numeric(10,4);

COMMENT ON COLUMN project_settings.autofix_max_spend_usd IS
  'Per-project USD ceiling for fix-worker LLM spend (rolling 30d from llm_invocations.cost_usd). NULL = unlimited.';
COMMENT ON COLUMN project_settings.autofix_max_dispatches_per_day IS
  'Max fix_dispatch_jobs started per UTC day. NULL = unlimited.';
COMMENT ON COLUMN project_settings.autofix_approval_cost_threshold_usd IS
  'When estimated dispatch cost exceeds this USD AND severity is high/critical, require manual approval before PR.';

-- ── Prompt canary controls ──────────────────────────────────────────────────
ALTER TABLE prompt_versions
  ADD COLUMN IF NOT EXISTS rollout_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollout_canary_pct int NOT NULL DEFAULT 0
    CHECK (rollout_canary_pct >= 0 AND rollout_canary_pct <= 100);

-- Preserve legacy A/B behaviour: existing candidates routed traffic via
-- traffic_percentage. The new rollout_canary_pct defaults to 0, which the prompt
-- router treats as "unset → fall back to traffic_percentage". Backfill so the
-- stored canary % matches what the router actually uses (and the console shows).
UPDATE prompt_versions
SET rollout_canary_pct = traffic_percentage
WHERE is_candidate = true
  AND coalesce(rollout_canary_pct, 0) = 0
  AND coalesce(traffic_percentage, 0) > 0;

-- ── Web push subscriptions (reporter opt-in) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.reporter_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reporter_token_hash text NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, reporter_token_hash, endpoint)
);

ALTER TABLE public.reporter_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reporter_push_subscriptions_deny_all ON public.reporter_push_subscriptions;
CREATE POLICY reporter_push_subscriptions_deny_all ON public.reporter_push_subscriptions
  AS RESTRICTIVE FOR ALL USING (false);

-- ── Public roadmap ──────────────────────────────────────────────────────────
-- The public roadmap is served exclusively through the service-role edge route
-- `GET /v1/public/roadmap/:projectSlug`, which returns a curated, PII-free
-- projection (id/subject/body/status/vote_count/comment_count/dates only).
-- We deliberately DO NOT `GRANT SELECT ... TO anon` on feature_requests_with_stats:
-- that view exposes user_email / user_id / admin_response, so a direct PostgREST
-- anon read would leak reporter PII. Keep all public access funneled through the
-- edge function projection instead.

-- ── Harden feature_requests_with_stats against cross-tenant reads ────────────
-- Migration 20260602200000 granted SELECT to `authenticated`, but NOTHING reads
-- this view via the authenticated PostgREST client (every reader is a
-- service-role edge route). Because the view is not security_invoker, an
-- authenticated PostgREST call would bypass support_tickets RLS and read every
-- project's reporter emails. Enforce RLS via security_invoker and revoke the
-- unused grant so any future authenticated read is tenant-scoped.
ALTER VIEW feature_requests_with_stats SET (security_invoker = on);
REVOKE SELECT ON feature_requests_with_stats FROM authenticated;

-- Flush PostgREST's in-memory schema + config cache so the new tables / views /
-- grants are visible immediately after deploy (repo convention for structural
-- migrations).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
