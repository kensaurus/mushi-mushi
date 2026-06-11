-- Phase I: screenshot ingest was failing because project_storage_settings pointed
-- at a non-existent bucket (mushi-screenshots). The cluster default is `screenshots`
-- (see 20260416000000_phase0_initial_schema.sql).

UPDATE project_storage_settings
SET bucket = 'screenshots'
WHERE project_id = '542b34e0-019e-41fe-b900-7b637717bb86'
  AND bucket = 'mushi-screenshots';
