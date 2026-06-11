-- Migration: 20260611120000_qa_stories_target_url
-- Adds target_url to qa_stories so firecrawl_actions stories can explicitly
-- declare their target instead of relying on DEFAULT_BASE_URL or prompt parsing.
--
-- Also adds notification-state columns used by Phase 1 deduplication logic:
--   last_run_status         – 'passed' | 'failed' | 'error' | 'skipped'
--   consecutive_failures    – reset to 0 on recovery, incremented on each failure
--   slack_failure_ts        – Slack message ts for threading follow-ups
--   last_notified_at        – when the most recent Slack notification was sent

ALTER TABLE qa_stories
  ADD COLUMN IF NOT EXISTS target_url text,
  ADD COLUMN IF NOT EXISTS last_run_status text,
  ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slack_failure_ts text,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

COMMENT ON COLUMN qa_stories.target_url IS
  'Explicit scrape target for firecrawl_actions/browserbase stories. Takes precedence over URLs parsed from the prompt or DEFAULT_BASE_URL.';

COMMENT ON COLUMN qa_stories.last_run_status IS
  'Status of the most recent run. Used to detect pass→fail / fail→pass transitions for deduped Slack notifications.';

COMMENT ON COLUMN qa_stories.consecutive_failures IS
  'Number of consecutive failed/errored runs since the last passing run. Used for notification backoff.';

COMMENT ON COLUMN qa_stories.slack_failure_ts IS
  'Slack message timestamp (ts) of the first failure notification. Allows threading follow-up posts.';

COMMENT ON COLUMN qa_stories.last_notified_at IS
  'Timestamp of most recent Slack notification for this story. Used as a daily-cap gate on repeated failures.';
