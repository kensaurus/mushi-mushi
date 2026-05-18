-- Migration: host_auth_providers
-- PURPOSE: P2 rewards — store per-project JWKS provider config for
--   verifying host-app JWTs before processing monetary payouts.
--   Supports Apple, Google, Supabase (sub-based JWT), and custom OIDC.
-- Gated by pricing_plans.feature_flags.rewards_monetary.

-- ── Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.host_auth_providers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider        text        NOT NULL CHECK (provider IN ('apple', 'google', 'supabase', 'custom')),
  jwks_url        text        NOT NULL,
  audience        text        NULL,
  issuer          text        NULL,
  enabled         boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider)
);

-- ── Updated-at trigger ────────────────────────────────────────────
CREATE OR REPLACE TRIGGER host_auth_providers_updated_at
  BEFORE UPDATE ON public.host_auth_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_host_auth_providers_project
  ON public.host_auth_providers (project_id);

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.host_auth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org member can manage host_auth_providers"
  ON public.host_auth_providers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = host_auth_providers.project_id
        AND private.is_org_member(p.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = host_auth_providers.project_id
        AND private.is_org_member(p.organization_id)
    )
  );

-- ── JWKS cache table ──────────────────────────────────────────────
-- Stores fetched JWKS payloads so edge functions don't re-fetch on
-- every request. Edge functions (Deno) do their own in-memory cache
-- but this provides a cross-function persistence layer for cold starts.
CREATE TABLE IF NOT EXISTS public.jwks_cache (
  jwks_url        text        PRIMARY KEY,
  payload         jsonb       NOT NULL,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

-- ── Admin routes: extend rewards routes ───────────────────────────
-- (Routes registered in api/routes/rewards.ts — no SQL needed)

-- ── Advisor: document the new table ──────────────────────────────
COMMENT ON TABLE public.host_auth_providers IS
  'P2 Rewards: per-project JWKS provider configuration for JWT verification '
  'before processing monetary payouts. Required by pricing_plans.feature_flags.rewards_monetary.';

COMMENT ON TABLE public.jwks_cache IS
  'Cross-function JWKS response cache. Edge functions also cache in Deno global '
  'memory; this table backs cold-start warm-up (TTL 1 hour default).';
