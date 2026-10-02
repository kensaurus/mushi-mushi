-- ============================================================================
-- 20261002160000_reporter_email_optin_caps
--
-- ADDITIVE — apply BEFORE deploying `api` and `reporter-notify-fanout`.
-- Every change is a new nullable column, a widened CHECK, or a new index, so
-- the functions running today keep working against it.
--
-- Plan 018 Phase 3 (docs/execplans/reporter-loop-v2.md §4.1, §4.3).
--
-- reporter_notification_prefs
--   unsubscribe_token     opaque random token in every email's
--                         List-Unsubscribe URL. Stored as is (not hashed):
--                         each send has to rebuild the URL, and the token can
--                         only stop mail to this one address. Rotated whenever
--                         the address changes. Service-role only table.
--   email_verify_sent_at  last verification mail: link expiry (7 days) and the
--                         resend throttle.
--   (email_verify_token_hash / email_verified_at / unsubscribed_at came in
--    20261002120300.)
--
-- notification_deliveries
--   status 'deferred'     an email over the frequency cap; the daily digest
--                         sends it later and flips the row to 'sent'.
--   digest_run_id         the digest run that claimed a deferred row, so a
--                         crashed run can not mail the same row twice.
--   digest_claimed_at     when it was claimed: a claim older than an hour
--                         (a run that died mid-send) is put back to deferred
--                         by the next run instead of being stranded.
--   Index for the per-reporter cap count (sent in the last 24 h).
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'reporter_notification_prefs'
--      and column_name in ('unsubscribe_token', 'email_verify_sent_at');          -- 2 rows
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'notification_deliveries'
--      and column_name in ('digest_run_id', 'digest_claimed_at');                 -- 2 rows
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'notification_deliveries_status_check';                     -- lists 'deferred'
--   select indexname from pg_indexes
--    where indexname in ('notification_deliveries_reporter_sent_idx',
--                        'notification_deliveries_deferred_idx',
--                        'reporter_notification_prefs_unsubscribe_token_key');   -- 3 rows
-- ============================================================================

alter table public.reporter_notification_prefs
  add column if not exists unsubscribe_token text,
  add column if not exists email_verify_sent_at timestamptz;

create unique index if not exists reporter_notification_prefs_unsubscribe_token_key
  on public.reporter_notification_prefs (unsubscribe_token)
  where unsubscribe_token is not null;

create index if not exists reporter_notification_prefs_verify_token_idx
  on public.reporter_notification_prefs (email_verify_token_hash)
  where email_verify_token_hash is not null;

alter table public.notification_deliveries
  add column if not exists digest_run_id uuid,
  add column if not exists digest_claimed_at timestamptz;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'sent', 'failed', 'skipped', 'deferred'));

create index if not exists notification_deliveries_reporter_sent_idx
  on public.notification_deliveries (project_id, reporter_token_hash, channel, sent_at desc)
  where status = 'sent';

create index if not exists notification_deliveries_deferred_idx
  on public.notification_deliveries (project_id, reporter_token_hash, created_at)
  where status = 'deferred';

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
