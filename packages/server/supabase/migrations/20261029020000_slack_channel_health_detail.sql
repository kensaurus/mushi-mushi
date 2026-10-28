-- ============================================================================
-- 20261029020000_slack_channel_health_detail
--
-- ADDITIVE: apply BEFORE deploying the functions that write this column
-- (api, integration-health-probe). A missing column makes those inserts
-- fail; sendBotMessage logs the failure and does not start the cooldown.
--
-- integration_health_history.message is the sentence shown in the console.
-- The Slack send cooldown used to recover channel_not_found / not_in_channel
-- / is_archived by matching phrases in that sentence, so a copy edit stopped
-- the cooldown from recognizing the channel. detail stores the code and the
-- channel id. Null on every older row and on probes that have no structured
-- facts. No secret is stored here.
--
-- RLS: the table already has RLS (members_read_health); a new column inherits
-- it.
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'integration_health_history' and column_name = 'detail';
-- ============================================================================

alter table public.integration_health_history
  add column if not exists detail jsonb;

comment on column public.integration_health_history.detail is
  'Structured probe facts. Slack channel failures store {slack_error, channel_id}. Null when the check has none, or the row was written before 20261029020000.';

notify pgrst, 'reload schema';
