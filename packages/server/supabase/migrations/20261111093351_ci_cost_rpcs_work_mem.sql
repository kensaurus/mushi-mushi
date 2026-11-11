-- Keep the CI cost RPCs in memory (2026-11-11 speed audit).
--
-- ci_cost_facts (3.4 s mean, 105 calls in 11 days) and ci_runner_comparison
-- (2.3 s) aggregate every ci_jobs row in the window; the window holds the
-- whole table, so no index helps. At the default work_mem both spilled their
-- sorts to disk (EXPLAIN ANALYZE: ~17k temp blocks read / ~9.6k written per
-- ci_cost_facts call, a 40 MB external merge for the step roll-up). 64 MB
-- for these two functions only keeps the sorts in memory.
alter function public.ci_cost_facts(uuid[], timestamptz, timestamptz) set work_mem = '64MB';
alter function public.ci_runner_comparison(uuid[], timestamptz, timestamptz) set work_mem = '64MB';
