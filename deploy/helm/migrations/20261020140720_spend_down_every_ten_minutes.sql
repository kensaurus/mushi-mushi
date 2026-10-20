-- Migration: 20261020140720_spend_down_every_ten_minutes
-- Purpose: Spend-down ticks every 10 minutes instead of every 30 (ADR 0028).
-- Many spend-down runs end within minutes (already fixed, or needs a
-- person), so at :28/:58 an app's three slots sat empty for most of each
-- half hour. 8-58/10 keeps :28 and :58 and stays off the codebase drain
-- (9-59/10). The worker is idempotent per tick: it re-reads running
-- attempts and today's count before each dispatch.
SELECT cron.alter_job(
  job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'mushi-spend-down'),
  schedule := '8-58/10 * * * *'
);
