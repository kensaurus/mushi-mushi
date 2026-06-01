-- Migration: slack_bot_cols
-- Adds per-project Slack bot configuration columns and a thread-TS column
-- on `reports` so that follow-up messages (fix dispatched, PR opened) are
-- posted as threaded replies to the original report notification.

-- Per-project Slack settings
alter table project_settings
  add column if not exists slack_channel_id  text,
  add column if not exists slack_team_id     text;

-- Thread timestamp captured from the initial chat.postMessage response.
-- NULL until the first Slack notification is sent for a report.
alter table reports
  add column if not exists slack_message_ts  text;

-- Optional index so finishDispatch can look up the ts quickly.
create index if not exists reports_slack_message_ts_idx
  on reports (slack_message_ts)
  where slack_message_ts is not null;
