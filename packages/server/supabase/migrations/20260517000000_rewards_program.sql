-- ============================================================
-- Rewards Program v1 — end-user identity, activity tracking,
-- configurable point rules, tier evaluation, and host-credit
-- webhook delivery.
--
-- Design decisions:
--   - Identity is org-scoped, not project-scoped. A learner using
--     glot.it web AND glot.it mobile accumulates points on one
--     per-org end_users row, not two per-project rows.
--   - Monetary payouts (P2) and JWKS-verified identity (P2) are
--     schema-ready here but gated behind feature_flags.
--   - Points are tracked in two tables: append-only
--     end_user_activity (audit trail) and denormalized
--     end_user_points (hot read path). A trigger keeps them in
--     sync so the API never needs a SUM query.
--   - Point rules are per-project rows in reward_rules, replacing
--     the hardcoded POINT_TABLE in _shared/reputation.ts.
--   - Anti-fraud: velocity caps live on reward_rules
--     (max_per_day / max_per_user_lifetime). Flagged users still
--     earn points (transparency) but cannot redeem monetary
--     rewards (P2 gate).
-- ============================================================

-- ============================================================
-- 0. Extend API key scopes to include activity:write / rewards:read
-- ============================================================

ALTER TABLE public.project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid;

ALTER TABLE public.project_api_keys
  ADD CONSTRAINT project_api_keys_scopes_valid
  CHECK (
    scopes <@ array['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read']::text[]
    AND cardinality(scopes) > 0
  );

-- Update the scope helper to understand the two new values.
CREATE OR REPLACE FUNCTION public.api_key_has_scope(p_scopes text[], p_required text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_required = 'mcp:read'
      THEN ('mcp:read' = ANY(p_scopes) OR 'mcp:write' = ANY(p_scopes))
    ELSE p_required = ANY(p_scopes)
  END;
$$;

COMMENT ON FUNCTION public.api_key_has_scope(text[], text) IS
  'True iff p_scopes grants p_required. mcp:write implies mcp:read. New in rewards v1: activity:write, rewards:read.';

-- ============================================================
-- 1. end_users — first-class per-org end-user identity
-- ============================================================
-- Keyed by (organization_id, external_user_id) so every
-- distinct authenticated user in the host app gets exactly one
-- row per mushi-mushi org — regardless of which project SDK
-- they were reported from.

CREATE TABLE IF NOT EXISTS public.end_users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The host app's user identifier (Supabase UUID, Apple sub, etc.)
  external_user_id  text        NOT NULL CHECK (length(external_user_id) BETWEEN 1 AND 512),
  -- SHA-256 of email; raw email is never stored here (host owns PII).
  email_hash        text        CHECK (email_hash IS NULL OR length(email_hash) = 64),
  display_name      text        CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 120),
  -- Auth provider reported by host: 'supabase' | 'apple' | 'google' | 'custom'
  jwt_provider      text,
  -- P2: the JWT subject claim (populated once verifyHostJwt passes)
  jwt_subject       text,
  jwt_verified_at   timestamptz,
  -- Consent for activity tracking (explicit opt-in)
  opted_in_to_rewards boolean NOT NULL DEFAULT false,
  -- Anti-fraud flags carried forward from reporter_devices
  anti_fraud_flags  text[]  NOT NULL DEFAULT '{}',
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT end_users_org_external_uniq UNIQUE (organization_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_end_users_org
  ON public.end_users (organization_id);
CREATE INDEX IF NOT EXISTS idx_end_users_org_external
  ON public.end_users (organization_id, external_user_id);
CREATE INDEX IF NOT EXISTS idx_end_users_last_seen
  ON public.end_users (organization_id, last_seen_at DESC);

ALTER TABLE public.end_users ENABLE ROW LEVEL SECURITY;

-- Operators (authenticated JWT) can see end users for their org.
CREATE POLICY end_users_org_member_select ON public.end_users
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

-- SDK activity ingest inserts via service_role only.
-- No direct authenticated INSERT — the edge function resolves the row.

COMMENT ON TABLE public.end_users IS
  'One row per distinct authenticated end-user per organization. Identity is supplied by the host app via Mushi.identify() and is intentionally opaque to Mushi — only an external_user_id + optional email_hash are persisted. Raw PII (email, name) stays in the host app.';

-- ============================================================
-- 2. reward_rules — configurable point rule catalog per project
-- ============================================================
-- Replaces the hardcoded POINT_TABLE in _shared/reputation.ts.
-- One row per (project_id, action). When a rule is missing for
-- an action, points default to 0 (safe-fallback, not an error).

CREATE TABLE IF NOT EXISTS public.reward_rules (
  id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL project_id = org-level default (used when a project has no override)
  project_id              uuid    REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id         uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Action identifier matching the SDK ActivityEvent.action field
  action                  text    NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  base_points             int     NOT NULL DEFAULT 0 CHECK (base_points >= -1000 AND base_points <= 10000),
  -- NULL = no daily cap
  max_per_day             int     CHECK (max_per_day IS NULL OR max_per_day > 0),
  -- NULL = no lifetime cap
  max_per_user_lifetime   int     CHECK (max_per_user_lifetime IS NULL OR max_per_user_lifetime > 0),
  -- When true, base_points is scaled by the user's reputation_score multiplier
  multiplier_eligible     boolean NOT NULL DEFAULT false,
  -- P2: require JWT verification before this action awards points
  requires_jwt_verification boolean NOT NULL DEFAULT false,
  enabled                 boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_rules_project_action_uniq UNIQUE (project_id, action),
  CONSTRAINT reward_rules_org_action_default_uniq UNIQUE NULLS NOT DISTINCT (organization_id, project_id, action)
);

CREATE INDEX IF NOT EXISTS idx_reward_rules_project
  ON public.reward_rules (project_id, action) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_reward_rules_org_default
  ON public.reward_rules (organization_id, action) WHERE project_id IS NULL AND enabled = true;

ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY reward_rules_org_member_select ON public.reward_rules
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));
CREATE POLICY reward_rules_org_admin_write ON public.reward_rules
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['admin']));

COMMENT ON TABLE public.reward_rules IS
  'Configurable point awards per action per project (or org-wide when project_id IS NULL). Replaces the hardcoded POINT_TABLE in _shared/reputation.ts. Seed rows for P1 actions are inserted below.';

-- ============================================================
-- 3. reward_tiers — tier ladder per organization
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reward_tiers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug                text        NOT NULL CHECK (slug ~ '^[a-z0-9_]{1,32}$'),
  display_name        text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  display_order       int         NOT NULL DEFAULT 0,
  points_threshold    int         NOT NULL DEFAULT 0 CHECK (points_threshold >= 0),
  -- Arbitrary perks object the admin defines (e.g. {"badge": "contributor", "color": "#6c47ff"})
  perks               jsonb       NOT NULL DEFAULT '{}',
  -- P2: monetary reward amount per tier (NULL = no cash payout)
  monetary_reward_usd numeric(10,2),
  -- Payload sent to the host's reward_webhooks endpoint on tier change
  host_credit_payload jsonb,
  enabled             boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_tiers_org_slug_uniq UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_reward_tiers_org
  ON public.reward_tiers (organization_id, display_order) WHERE enabled = true;

ALTER TABLE public.reward_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY reward_tiers_org_member_select ON public.reward_tiers
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));
CREATE POLICY reward_tiers_org_admin_write ON public.reward_tiers
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['admin']));

COMMENT ON TABLE public.reward_tiers IS
  'Tier ladder for an organization. Points thresholds are cumulative lifetime points. When an end user crosses a threshold the tier-evaluator fires a webhook and optionally enqueues a payout.';

-- ============================================================
-- 4. end_user_points — hot-read denormalization of point totals
-- ============================================================
-- One row per end_user. Updated atomically by
-- private.apply_activity_points() trigger on end_user_activity.

CREATE TABLE IF NOT EXISTS public.end_user_points (
  end_user_id         uuid        PRIMARY KEY REFERENCES public.end_users(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  total_points        int         NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  points_30d          int         NOT NULL DEFAULT 0 CHECK (points_30d >= 0),
  points_lifetime     int         NOT NULL DEFAULT 0 CHECK (points_lifetime >= 0),
  current_tier_id     uuid        REFERENCES public.reward_tiers(id) ON DELETE SET NULL,
  last_evaluated_at   timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_end_user_points_org_total
  ON public.end_user_points (organization_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_end_user_points_org_30d
  ON public.end_user_points (organization_id, points_30d DESC);

ALTER TABLE public.end_user_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY end_user_points_org_member_select ON public.end_user_points
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

COMMENT ON TABLE public.end_user_points IS
  'Denormalized totals for the leaderboard hot path. Kept in sync by private.apply_activity_points() trigger so reads never need a SUM query.';

-- ============================================================
-- 5. end_user_activity — append-only event log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.end_user_activity (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  end_user_id         uuid        NOT NULL REFERENCES public.end_users(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id          uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  action              text        NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  -- Points actually awarded (0 if capped, anti-fraud rejected, or rule base=0)
  points_awarded      int         NOT NULL DEFAULT 0,
  -- FK to the reward_rules row that drove this award (NULL = legacy/manual)
  rule_id             uuid        REFERENCES public.reward_rules(id) ON DELETE SET NULL,
  -- Anti-fraud rejection reason (NULL = allowed, non-NULL = withheld)
  rejected_reason     text,
  -- Arbitrary SDK metadata (route, feature, etc.)
  metadata            jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Rolling 90-day retention window (pruned by cron)
  retain_until        timestamptz NOT NULL DEFAULT (now() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_end_user_activity_user_created
  ON public.end_user_activity (end_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_end_user_activity_org_created
  ON public.end_user_activity (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_end_user_activity_retain
  ON public.end_user_activity (retain_until);
-- Velocity-cap check: count per user per action per day
CREATE INDEX IF NOT EXISTS idx_end_user_activity_velocity
  ON public.end_user_activity (end_user_id, action, created_at DESC);

ALTER TABLE public.end_user_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY end_user_activity_org_member_select ON public.end_user_activity
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

COMMENT ON TABLE public.end_user_activity IS
  'Immutable audit trail of every activity event. Rejected events (anti-fraud) are persisted with points_awarded=0 + rejected_reason for transparency. Pruned by retention cron.';

-- ============================================================
-- 6. reward_webhooks — host-side credit delivery config
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reward_webhooks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url                 text        NOT NULL CHECK (url ~ '^https://'),
  -- SHA-256 of the raw secret; raw secret never stored
  secret_hash         text        NOT NULL,
  -- Which reward events to deliver (e.g. '{reward.tier_changed,reward.points_awarded}')
  events              text[]      NOT NULL DEFAULT '{reward.tier_changed}'::text[],
  enabled             boolean     NOT NULL DEFAULT true,
  last_delivered_at   timestamptz,
  last_status         int,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_webhooks_org
  ON public.reward_webhooks (organization_id) WHERE enabled = true;

ALTER TABLE public.reward_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY reward_webhooks_org_admin ON public.reward_webhooks
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['admin']));

COMMENT ON TABLE public.reward_webhooks IS
  'HMAC-signed webhook endpoints the host app registers to receive reward events (tier changes, points awards). The host verifies the signature and applies credits (gems, coupons, etc.) in its own billing system.';

-- ============================================================
-- 7. Extend project_settings with rewards columns
-- ============================================================

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS rewards_enabled          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rewards_default_preset   text    NOT NULL DEFAULT 'engagement_only',
  ADD COLUMN IF NOT EXISTS rewards_anti_fraud_strict boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_settings_rewards_preset_check'
      AND conrelid = 'public.project_settings'::regclass
  ) THEN
    ALTER TABLE public.project_settings
      ADD CONSTRAINT project_settings_rewards_preset_check
      CHECK (rewards_default_preset IN ('off', 'engagement_only', 'quality_bounty', 'full'));
  END IF;
END;
$$;

-- ============================================================
-- 8. Extend pricing_plans.feature_flags with rewards gates
-- ============================================================
-- Hobby:      rewards visible/read-only
-- Starter+:   full P1 (configure rules, tiers, webhooks)
-- Pro+:       P2 monetary payouts via Stripe Connect

UPDATE public.pricing_plans
SET feature_flags = feature_flags
  || '{"rewards_program": false, "rewards_monetary": false}'::jsonb
WHERE id = 'hobby'
  AND (feature_flags->>'rewards_program') IS NULL;

UPDATE public.pricing_plans
SET feature_flags = feature_flags
  || '{"rewards_program": true, "rewards_monetary": false}'::jsonb
WHERE id = 'starter'
  AND (feature_flags->>'rewards_program') IS NULL;

UPDATE public.pricing_plans
SET feature_flags = feature_flags
  || '{"rewards_program": true, "rewards_monetary": false}'::jsonb
WHERE id = 'pro'
  AND (feature_flags->>'rewards_program') IS NULL;

UPDATE public.pricing_plans
SET feature_flags = feature_flags
  || '{"rewards_program": true, "rewards_monetary": true}'::jsonb
WHERE id = 'enterprise'
  AND (feature_flags->>'rewards_program') IS NULL;

-- ============================================================
-- 9. Extend reports with end_user_id FK
-- ============================================================

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS end_user_id uuid REFERENCES public.end_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_end_user
  ON public.reports (end_user_id) WHERE end_user_id IS NOT NULL;

COMMENT ON COLUMN public.reports.end_user_id IS
  'FK to end_users populated by resolveEndUser() during ingest when the SDK supplies metadata.user.id. Supersedes the reporter_user_id text column (which stays for backward compat).';

-- ============================================================
-- 10. Trigger: apply_activity_points
--     Keeps end_user_points in sync on every insert into
--     end_user_activity without requiring a separate UPDATE call
--     in the edge function.
-- ============================================================

CREATE OR REPLACE FUNCTION private.apply_activity_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.end_user_points (
    end_user_id, organization_id, total_points, points_30d, points_lifetime
  ) VALUES (
    NEW.end_user_id, NEW.organization_id, GREATEST(0, NEW.points_awarded),
    GREATEST(0, NEW.points_awarded), GREATEST(0, NEW.points_awarded)
  )
  ON CONFLICT (end_user_id) DO UPDATE SET
    total_points    = GREATEST(0, end_user_points.total_points + NEW.points_awarded),
    points_lifetime = end_user_points.points_lifetime + GREATEST(0, NEW.points_awarded),
    updated_at      = now();

  -- Update last_seen_at on the parent end_users row (coalesced to 5 min)
  UPDATE public.end_users
  SET last_seen_at = now(), updated_at = now()
  WHERE id = NEW.end_user_id
    AND (last_seen_at IS NULL OR last_seen_at < now() - INTERVAL '5 minutes');

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_activity_points() FROM public;
GRANT EXECUTE ON FUNCTION private.apply_activity_points() TO service_role;

DROP TRIGGER IF EXISTS trg_apply_activity_points ON public.end_user_activity;
CREATE TRIGGER trg_apply_activity_points
  AFTER INSERT ON public.end_user_activity
  FOR EACH ROW EXECUTE FUNCTION private.apply_activity_points();

COMMENT ON FUNCTION private.apply_activity_points() IS
  'Maintains end_user_points totals atomically on every activity insert. Points are never negative (GREATEST 0). points_30d is recalculated by a daily cron (retention_sweep extension); this trigger handles the running total only.';

-- ============================================================
-- 11. Cron: prune end_user_activity past retain_until
--     Mirrors the retention_sweep cron for reports.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'prune-end-user-activity',
      '0 3 * * *',  -- daily at 03:00 UTC
      $sql$
        DELETE FROM public.end_user_activity WHERE retain_until < now();
      $sql$
    );
  END IF;
END;
$$;

-- ============================================================
-- 12. Seed default reward_rules for org "system defaults"
--     (rows with project_id = NULL will be used as fallbacks)
--
-- These are per-ORGANIZATION rows. Because every org starts
-- without explicit rules, the edge function falls back to a
-- hardcoded default table. The seed below creates a sentinel
-- lookup table that operators can override per-org or per-project.
--
-- NOTE: We do NOT insert org-specific rows here because no
-- orgs exist at migration time. The admin UI + /v1/admin/rewards/rules
-- endpoints manage these rows at runtime.
-- ============================================================

-- ============================================================
-- 13. Seed default reward_tiers per organization
--     Same pattern: no orgs exist at migration time.
--     The edge function `resolveOrgTiers` falls back to a
--     hardcoded DEFAULT_TIERS array if reward_tiers is empty
--     for an org.
-- ============================================================

-- ============================================================
-- 14. touch_end_user_activity_consent — SECURITY DEFINER helper
--     called by the SDK activity endpoint to toggle opted_in.
-- ============================================================

CREATE OR REPLACE FUNCTION private.set_end_user_rewards_consent(
  p_end_user_id uuid,
  p_opted_in    boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.end_users
  SET opted_in_to_rewards = p_opted_in,
      updated_at          = now()
  WHERE id = p_end_user_id;
$$;

REVOKE ALL ON FUNCTION private.set_end_user_rewards_consent(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION private.set_end_user_rewards_consent(uuid, boolean) TO service_role;

-- ============================================================
-- 15. GDPR helpers
-- ============================================================

-- export: returns all activity history as JSONB for data-export endpoint
CREATE OR REPLACE FUNCTION public.export_end_user_data(p_end_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'end_user', row_to_json(eu),
    'points',   row_to_json(eup),
    'activity', coalesce(
      (SELECT jsonb_agg(a ORDER BY a.created_at DESC) FROM end_user_activity a WHERE a.end_user_id = p_end_user_id),
      '[]'::jsonb
    )
  )
  FROM end_users eu
  LEFT JOIN end_user_points eup ON eup.end_user_id = eu.id
  WHERE eu.id = p_end_user_id;
$$;

REVOKE ALL ON FUNCTION public.export_end_user_data(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.export_end_user_data(uuid) TO service_role;

COMMENT ON FUNCTION public.export_end_user_data(uuid) IS
  'GDPR data export: returns all activity, points and profile data for a given end_user.id. Called by GET /v1/sdk/me/export.';

-- Hard-delete: cascades through end_user_activity + end_user_points via FK ON DELETE CASCADE
-- No special function needed; the caller just deletes the end_users row.

-- ============================================================
-- Comments on extension columns
-- ============================================================
COMMENT ON COLUMN public.project_settings.rewards_enabled IS
  'Master on/off for the rewards program. Controls whether the SDK activity endpoint accepts events for this project.';
COMMENT ON COLUMN public.project_settings.rewards_default_preset IS
  'Default rule preset applied when the org has no explicit reward_rules rows. off=no points, engagement_only=navigation/session, quality_bounty=bug-quality focused, full=all actions.';
COMMENT ON COLUMN public.reports.end_user_id IS
  'FK to end_users.id; populated during ingest when metadata.user.id is present.';
