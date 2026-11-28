-- =============================================================================
-- 20261127150000_ux_native_captures
--
-- ADR 0073 (Plan 025 P2): UX captures from any driver, native apps included.
-- POST /v1/ux/captures (api-ext) and `mushi-ux upload <dir>` put captures a
-- Maestro flow, adb, the iOS simulator or an SDK's debug screenshot made into
-- a scorecard run (ux_runs.kind = 'scorecard'), so the rubric, its probes and
-- the judge apply unchanged. These columns say where a run's captures came
-- from, for the platform badge in the UX runs list.
--
--   ux_runs.platform        web (default; every existing row) | ios | android |
--                           flutter | react_native | capacitor | other
--   ux_runs.device          the device or simulator the driver named, e.g.
--                           "Pixel 8 (API 35)" or "iPhone 16 simulator"
--   ux_runs.capture_source  playwright | maestro | adb | simctl | sdk | other
--
-- ADDITIVE and idempotent: new defaulted / nullable columns only. Apply BEFORE
-- deploying api-ext.
--
-- Verify after apply:
--   select column_name, column_default from information_schema.columns
--    where table_name = 'ux_runs' and column_name in ('platform', 'device', 'capture_source');
--   select count(*) from public.ux_runs where platform <> 'web';   -- 0 right after apply
-- =============================================================================

ALTER TABLE public.ux_runs
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web', 'ios', 'android', 'flutter', 'react_native', 'capacitor', 'other')),
  ADD COLUMN IF NOT EXISTS device text
    CHECK (device IS NULL OR char_length(device) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS capture_source text
    CHECK (capture_source IS NULL OR capture_source IN ('playwright', 'maestro', 'adb', 'simctl', 'sdk', 'other'));

COMMENT ON COLUMN public.ux_runs.platform IS
  'ADR 0073: where the run''s captures came from. web for browser runs (every run before 2026-11-27); ios, android, flutter, react_native, capacitor or other for captures uploaded through POST /v1/ux/captures.';
COMMENT ON COLUMN public.ux_runs.device IS
  'ADR 0073: the device or simulator the capture driver named (free text, at most 120 characters).';
COMMENT ON COLUMN public.ux_runs.capture_source IS
  'ADR 0073: the driver that made the captures: playwright, maestro, adb, simctl, sdk (an SDK''s debug ScreenshotCapture) or other.';
