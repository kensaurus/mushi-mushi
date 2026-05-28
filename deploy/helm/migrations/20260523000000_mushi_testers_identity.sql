-- Migration: mushi_testers_identity
-- PURPOSE: Wave 1 of the Mushi Bounties tester marketplace.
--   Adds a Mushi-owned tester identity layer that is distinct from the
--   existing `end_users` table (which is per-host-app and never has a
--   Mushi-side login). Testers sign in via Supabase auth.users (magic-link),
--   and this table is the cross-app ledger anchor for rewards.

-- ── mushi_testers ──────────────────────────────────────────────────────────
-- One row per tester. Keyed to auth.users (the Supabase auth identity).
-- NOT related to organization_members — testers are a parallel identity layer.
CREATE TABLE IF NOT EXISTS public.mushi_testers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        uuid        UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        text,
  -- public_handle is the only identity exposed on the leaderboard and in
  -- submission reviewer cards. Never expose auth_user_id or email externally.
  public_handle       text        UNIQUE,
  country_code        text        CHECK (length(country_code) = 2),
  locale              text,
  timezone            text,
  marketing_opt_in    boolean     NOT NULL DEFAULT false,
  terms_accepted_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER mushi_testers_updated_at
  BEFORE UPDATE ON public.mushi_testers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mushi_testers_auth_user
  ON public.mushi_testers (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_mushi_testers_handle
  ON public.mushi_testers (public_handle)
  WHERE public_handle IS NOT NULL;

-- RLS: only the owning auth user can read/write their own row.
-- The mushi_internal_admin claim (checked via app_metadata) bypasses for ops.
ALTER TABLE public.mushi_testers ENABLE ROW LEVEL SECURITY;

CREATE POLICY mushi_testers_self_rw ON public.mushi_testers
  FOR ALL TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Service role bypasses RLS by default (Supabase default).

COMMENT ON TABLE public.mushi_testers IS
  'Mushi-owned tester identity. Each row corresponds to one auth.users row. '
  'Cross-app; not scoped to any organization. The public_handle is the only '
  'field exposed on public leaderboards and reviewer cards.';

-- ── mushi_tester_profiles ──────────────────────────────────────────────────
-- Extended profile info stored separately to keep the base table slim
-- and avoid nullable columns cluttering the hot path.
CREATE TABLE IF NOT EXISTS public.mushi_tester_profiles (
  tester_id       uuid        PRIMARY KEY REFERENCES public.mushi_testers(id) ON DELETE CASCADE,
  bio             text        CHECK (length(bio) <= 500),
  avatar_url      text,
  expertise_tags  text[]      NOT NULL DEFAULT '{}',
  languages       text[]      NOT NULL DEFAULT '{}',
  -- devices is a jsonb array of {os, os_version, device_type, model?}
  devices         jsonb       NOT NULL DEFAULT '[]',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER mushi_tester_profiles_updated_at
  BEFORE UPDATE ON public.mushi_tester_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.mushi_tester_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY mushi_tester_profiles_self_rw ON public.mushi_tester_profiles
  FOR ALL TO authenticated
  USING (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()))
  WITH CHECK (tester_id IN (SELECT id FROM public.mushi_testers WHERE auth_user_id = auth.uid()));

COMMENT ON TABLE public.mushi_tester_profiles IS
  'Extended profile for mushi_testers. Separated from the base table so '
  'the core identity row stays fast to read in auth middleware.';
