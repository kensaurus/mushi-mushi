-- Drop indexes nothing reads (2026-11-11 cost audit): 0 scans since the stats
-- restart on 2026-10-31, and no function or edge query can use them.
--
-- Kept on purpose: idx_embeddings_default (report_embeddings HNSW, also 0
-- scans). match_report_embeddings (20261030190000) switches to it once a
-- project holds more than 2000 embeddings; no project is that large yet.
--
--   idx_mistake_clusters_centroid  13 MB  HNSW on centroid; no query orders
--                                          clusters by vector distance.
--   webhook_audit_log_source_ip_idx 12 MB  webhook rate limits are in memory
--                                          (_shared/webhook-middleware.ts).
--   idx_pipeline_runs_name_started 11 MB  pipeline_runs is written, never
--                                          read by run_name.
--   scoped_rate_limits_user_scope_window_idx 7 MB  same columns as the
--                                          primary key, which serves
--                                          scoped_rate_limit_claim's lookup.

set lock_timeout = '5s';

drop index if exists public.idx_mistake_clusters_centroid;
drop index if exists public.webhook_audit_log_source_ip_idx;
drop index if exists public.idx_pipeline_runs_name_started;
drop index if exists public.scoped_rate_limits_user_scope_window_idx;
