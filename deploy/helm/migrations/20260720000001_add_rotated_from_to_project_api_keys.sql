-- Migration: add rotated_from to project_api_keys (Phase 2 SDK/CLI/MCP uplift)
-- Purpose: track key rotation lineage so the predecessor can be auto-revoked
--          after the successor key is first used (grace-period rotation pattern).
--
-- revoked_at was already present in an earlier migration; this adds rotated_from.

ALTER TABLE public.project_api_keys
  ADD COLUMN IF NOT EXISTS rotated_from UUID REFERENCES public.project_api_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.project_api_keys.rotated_from IS
  'If this key was created by rotating another key, points to the predecessor key id. Used to revoke the predecessor after a grace period.';

CREATE INDEX IF NOT EXISTS idx_project_api_keys_rotated_from
  ON public.project_api_keys(rotated_from)
  WHERE rotated_from IS NOT NULL;
