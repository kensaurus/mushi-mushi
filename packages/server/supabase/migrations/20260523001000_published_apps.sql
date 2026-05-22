-- Migration: published_apps
-- PURPOSE: Wave 1 — dev-side publishing controls for the Mushi Bounties
--   marketplace. A dev publishes one app listing per project. Testers browse
--   published_apps where visibility='public' without authentication.

-- ── published_apps ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.published_apps (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  slug                text        UNIQUE NOT NULL CHECK (
                                    slug ~ '^[a-z0-9][a-z0-9\-]{1,60}[a-z0-9]$'
                                  ),
  name                text        NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  tagline             text        CHECK (length(tagline) <= 140),
  description         text        CHECK (length(description) <= 4000),
  hero_url            text,
  screenshots_urls    text[]      NOT NULL DEFAULT '{}',
  app_store_url       text,
  play_store_url      text,
  web_url             text,
  platforms           text[]      NOT NULL DEFAULT '{}',
  -- auto_seer_analyze: when true, Wave 6 triggers Sentry Seer on new tester submissions.
  auto_seer_analyze   boolean     NOT NULL DEFAULT false,
  -- sentry_dsn: the dev's own Sentry project DSN for routing tester-submitted events.
  sentry_dsn          text,
  visibility          text        NOT NULL DEFAULT 'draft'
                        CHECK (visibility IN ('draft', 'public', 'invite_only', 'paused')),
  published_at        timestamptz,
  paused_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER published_apps_updated_at
  BEFORE UPDATE ON public.published_apps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One published app per project (a project publishes one listing).
CREATE UNIQUE INDEX IF NOT EXISTS idx_published_apps_project
  ON public.published_apps (project_id);

CREATE INDEX IF NOT EXISTS idx_published_apps_visibility
  ON public.published_apps (visibility, published_at DESC)
  WHERE visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_published_apps_org
  ON public.published_apps (organization_id);

-- RLS:
--   • anon/authenticated can SELECT rows where visibility='public'
--   • project owners + org admins can INSERT/UPDATE/DELETE
ALTER TABLE public.published_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY published_apps_public_read ON public.published_apps
  FOR SELECT TO anon, authenticated
  USING (visibility = 'public');

CREATE POLICY published_apps_org_admin_all ON public.published_apps
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['owner', 'admin', 'member']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner', 'admin', 'member']));

COMMENT ON TABLE public.published_apps IS
  'One listing per project in the Mushi Bounties tester marketplace. '
  'Rows with visibility=public are readable by anonymous users (SSR). '
  'Requires marketplace_publish entitlement (Pro+ plans, cloud-only).';

-- ── published_app_bounties ─────────────────────────────────────────────────
-- Per-app override on org-level reward_rules. Dev can set custom point
-- values per action for their published app.
CREATE TABLE IF NOT EXISTS public.published_app_bounties (
  id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                  uuid    NOT NULL REFERENCES public.published_apps(id) ON DELETE CASCADE,
  action                  text    NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  points_per_event        int     NOT NULL DEFAULT 0 CHECK (points_per_event BETWEEN 0 AND 10000),
  daily_cap               int     CHECK (daily_cap > 0),
  lifetime_cap_per_tester int     CHECK (lifetime_cap_per_tester > 0),
  enabled                 boolean NOT NULL DEFAULT true,
  multiplier_eligible     boolean NOT NULL DEFAULT false,
  UNIQUE (app_id, action)
);

ALTER TABLE public.published_app_bounties ENABLE ROW LEVEL SECURITY;

CREATE POLICY published_app_bounties_public_read ON public.published_app_bounties
  FOR SELECT TO anon, authenticated
  USING (app_id IN (SELECT id FROM public.published_apps WHERE visibility = 'public'));

CREATE POLICY published_app_bounties_org_admin ON public.published_app_bounties
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM public.published_apps pa
      WHERE private.has_org_role(pa.organization_id, ARRAY['owner', 'admin', 'member'])
    )
  )
  WITH CHECK (
    app_id IN (
      SELECT id FROM public.published_apps pa
      WHERE private.has_org_role(pa.organization_id, ARRAY['owner', 'admin', 'member'])
    )
  );

-- ── published_app_targeting ────────────────────────────────────────────────
-- Who can join this app's tester program. Enforced at join time.
CREATE TABLE IF NOT EXISTS public.published_app_targeting (
  app_id          uuid    PRIMARY KEY REFERENCES public.published_apps(id) ON DELETE CASCADE,
  min_age         int     CHECK (min_age IS NULL OR min_age BETWEEN 13 AND 100),
  country_codes   text[]  NOT NULL DEFAULT '{}', -- empty = unrestricted
  languages       text[]  NOT NULL DEFAULT '{}', -- empty = unrestricted
  required_devices jsonb  NOT NULL DEFAULT '[]',
  expertise_tags  text[]  NOT NULL DEFAULT '{}', -- empty = unrestricted
  reputation_min  int     NOT NULL DEFAULT 0
);

ALTER TABLE public.published_app_targeting ENABLE ROW LEVEL SECURITY;

CREATE POLICY published_app_targeting_public_read ON public.published_app_targeting
  FOR SELECT TO anon, authenticated
  USING (app_id IN (SELECT id FROM public.published_apps WHERE visibility = 'public'));

CREATE POLICY published_app_targeting_org_admin ON public.published_app_targeting
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM public.published_apps pa
      WHERE private.has_org_role(pa.organization_id, ARRAY['owner', 'admin', 'member'])
    )
  )
  WITH CHECK (
    app_id IN (
      SELECT id FROM public.published_apps pa
      WHERE private.has_org_role(pa.organization_id, ARRAY['owner', 'admin', 'member'])
    )
  );
