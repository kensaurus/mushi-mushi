-- ============================================================================
-- 20261113114507_cloudwatch_sns_topic_arn_check (ADR 0061)
--
-- The first apply of 20261113114348 on the hosted project used `{1,256}` in
-- the topic-ARN check; Postgres caps a regex repetition count at 255, so
-- every non-null value raised "invalid repetition count(s)". The file now
-- carries the fixed check; this restates it so a database that ran the first
-- version ends up identical. Idempotent: a fresh install drops and re-adds
-- the same constraint.
-- ============================================================================

ALTER TABLE public.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_cloudwatch_sns_topic_arn_check;

ALTER TABLE public.project_settings
  ADD CONSTRAINT project_settings_cloudwatch_sns_topic_arn_check
  CHECK (cloudwatch_sns_topic_arn IS NULL OR (cloudwatch_sns_topic_arn ~ '^arn:aws:sns:[a-z]{2}(-[a-z]+)+-[0-9]:[0-9]{12}:[A-Za-z0-9_-]+$' AND char_length(cloudwatch_sns_topic_arn) <= 300));
