-- §3c: extend `reporter_devices` with the columns the SDK fingerprint
-- pipeline depends on. The columns were applied directly on the cloud project
-- ahead of this file landing; this migration codifies them so a fresh
-- `supabase db reset` replays the schema correctly.
--
-- New columns:
--   * fingerprint_hash       — SHA-256 of stable device characteristics
--                              produced by `@mushi-mushi/core` getDeviceFingerprintHash().
--                              Survives reporter-token rotation; the
--                              cross-account anti-gaming check keys on this.
--   * cross_account_flagged  — dedicated boolean so the admin "Cross-account"
--                              flag is independent of the legacy
--                              `flagged_as_suspicious` column.
--   * distinct_user_count    — best-effort count of distinct reporter
--                              identities seen on this device. We use
--                              `length(reporter_tokens)` as a proxy when no
--                              explicit reporterUserId is supplied by the SDK.

ALTER TABLE reporter_devices
  ADD COLUMN IF NOT EXISTS fingerprint_hash      TEXT,
  ADD COLUMN IF NOT EXISTS cross_account_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS distinct_user_count   INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS reporter_devices_fingerprint_hash_idx
  ON reporter_devices (project_id, fingerprint_hash)
  WHERE fingerprint_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS reporter_devices_cross_account_flagged_idx
  ON reporter_devices (project_id)
  WHERE cross_account_flagged = TRUE;

COMMENT ON COLUMN reporter_devices.fingerprint_hash IS
  'SHA-256 hex of stable client-device characteristics emitted by the SDK. Used as the join key for the cross-account anti-gaming check.';
COMMENT ON COLUMN reporter_devices.cross_account_flagged IS
  'TRUE when distinct_user_count crossed CROSS_ACCOUNT_THRESHOLD (5). Independent of the legacy flagged_as_suspicious flag.';
COMMENT ON COLUMN reporter_devices.distinct_user_count IS
  'Best-effort count of distinct reporter identities seen on this device.';
