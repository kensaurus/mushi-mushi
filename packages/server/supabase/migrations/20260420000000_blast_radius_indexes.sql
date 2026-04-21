-- (M1): Real blast-radius for /v1/admin/reports.
--
-- Today the admin Reports table shows `dedup_count` (= report_groups.report_count)
-- as a proxy for "how many users felt this." That number conflates one user
-- spamming F12 with five distinct people hitting the same bug. Switching to
-- COUNT(DISTINCT reporter_token_hash) gives the real blast radius.
--
-- Why `reporter_token_hash` and not `reporter_user_id`:
--   - `reporter_token_hash text not null` is set on every row by the SDK and
--     is stable per-device (see anti-gaming, reputation, notifications which
--     all key off it).
--   - `reporter_user_id text null` is only populated when the SDK can pull an
--     authenticated user id out of report.metadata.user.id, which is empty
--     for the dominant shake-to-report / anonymous-feedback case. Counting
--     distinct values would silently undercount to ~0.
-- - Product intent (per README + apps/admin/README + handover) is
--     "how many distinct people felt this," and device-stable token is the
--     correct proxy in the absence of auth.
--
-- We deliberately *do not* maintain a tally counter via INSERT triggers — Citus's
-- "Faster PostgreSQL Counting" benchmarks (https://www.citusdata.com/blog/2016/10/12/count-performance/)
-- show trigger-maintained counters slow inserts ~50x, which is unacceptable for
-- the write-heavy intake stage. Instead we rely on covering indexes that turn
-- the per-request COUNT(DISTINCT) into an index-only scan.
--
-- The RPC wrapper batches every visible group into one round-trip so the API
-- handler stays at O(1) DB calls.

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Partial indexes keep them small (most reports do have a group_id once
-- classification has run, but rows landing pre-classification have NULL).
-- Both columns sit on `reports`; no FK changes required.
--
-- NOTE: We deliberately do NOT use `CONCURRENTLY` here. Supabase migrations
-- run inside a single transaction per file (`supabase db push`), and
-- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
-- (PostgreSQL 25001 — "cannot run inside a transaction block"). The
-- `reports` table is small enough on every project we've seen that the
-- AccessExclusiveLock during the build is sub-second; if a future tenant
-- crosses the multi-million-row mark, split this into a `supabase
-- migration new` with a non-transactional preface (`-- supabase: --no-tx`)
-- so the lock is released between statements.
create index if not exists reports_group_token_idx
  on reports (report_group_id, reporter_token_hash)
  where report_group_id is not null;

create index if not exists reports_group_session_idx
  on reports (report_group_id, session_id)
  where report_group_id is not null and session_id is not null;

-- ---------------------------------------------------------------------------
-- RPC: report_group_blast_radius
-- ---------------------------------------------------------------------------
-- PostgREST cannot do GROUP BY through the `select(...)` chain, so we expose a
-- typed function instead. Callers pass an array of group ids (the API handler
-- already builds that set from the report rows it just fetched) and receive
-- one row per group with the three counts pre-aggregated.
create or replace function report_group_blast_radius(p_group_ids uuid[])
returns table (
  report_group_id uuid,
  report_count bigint,
  unique_users bigint,
  unique_sessions bigint
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    r.report_group_id,
    count(*)::bigint                                     as report_count,
    count(distinct r.reporter_token_hash)::bigint        as unique_users,
    count(distinct r.session_id)::bigint                 as unique_sessions
  from reports r
  where r.report_group_id = any(p_group_ids)
  group by r.report_group_id
$$;

comment on function report_group_blast_radius(uuid[]) is
  'per-group COUNT(*) + COUNT(DISTINCT reporter_token_hash/session_id). Backs the real blast-radius column on /v1/admin/reports. Index-only scan via reports_group_token_idx / reports_group_session_idx.';

-- API runs as service_role; restrict the RPC accordingly so anon/authenticated
-- callers cannot reach it directly (they have RLS-scoped access via the
-- /v1/admin/reports endpoint instead).
revoke all on function report_group_blast_radius(uuid[]) from public;
revoke all on function report_group_blast_radius(uuid[]) from anon;
revoke all on function report_group_blast_radius(uuid[]) from authenticated;
grant execute on function report_group_blast_radius(uuid[]) to service_role;
