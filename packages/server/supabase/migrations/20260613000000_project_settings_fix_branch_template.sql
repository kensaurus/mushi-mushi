-- Add configurable fix-branch naming template to project_settings.
-- Default produces branches like: mushi/fix/2026-06-13-visual-a1b2c3d4
-- Tokens: {date} = YYYY-MM-DD, {category} = report category slug, {shortId} = reportId[:8]
-- Set to NULL or '' to fall back to the legacy mushi/fix-{shortId}-{timestamp36} scheme.
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS fix_branch_template TEXT
    DEFAULT 'mushi/fix/{date}-{category}-{shortId}';
