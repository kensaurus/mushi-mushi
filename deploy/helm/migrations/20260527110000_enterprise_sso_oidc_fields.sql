-- Add OIDC-specific fields to enterprise_sso_configs.
-- Client ID, Client Secret (stored as hint — full value never returned by API),
-- and Issuer URL are needed to record OIDC provider config for audit and for
-- Supabase enterprise tier manual wiring.
ALTER TABLE public.enterprise_sso_configs
  ADD COLUMN IF NOT EXISTS oidc_client_id TEXT,
  ADD COLUMN IF NOT EXISTS oidc_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS oidc_issuer_url TEXT;
