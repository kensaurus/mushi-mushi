-- Phase 0.3: Remove the superseded projects.data_region (text, default 'us-east-1').
-- Backfill data_residency_region from data_region where null.
UPDATE projects
SET data_residency_region = CASE
  WHEN data_region LIKE 'eu%' THEN 'eu'::residency_region
  WHEN data_region LIKE 'ap-northeast%' OR data_region LIKE 'ap-east%' THEN 'jp'::residency_region
  ELSE 'us'::residency_region
END
WHERE data_residency_region IS NULL AND data_region IS NOT NULL;

ALTER TABLE projects DROP COLUMN IF EXISTS data_region;
