-- ============================================================================
-- 20261002120100_reporter_notifications_v2
--
-- Plan 018 (docs/execplans/reporter-loop-v2.md §6.1, migration 2).
--
-- reporter_notifications becomes the reporter-visible event log:
--   status         held (review-mode outbox) | sent | discarded. Every reporter
--                  read path filters status = 'sent'.
--   body_override  an admin's edit of a held pipeline message
--   released_by/at who released a held message, and when
--   dedupe_key     one row per (report, type, key): comment id for replies,
--                  canonical report id for duplicate notices, release id for
--                  releases, follower key for followers
--
-- notification_deliveries gains dedupe_key too. Its UNIQUE (report, type,
-- channel) constraint becomes a unique index over (report, type, channel,
-- coalesce(dedupe_key, '')) — Postgres does not allow an expression in a
-- UNIQUE constraint. The new index is created before the old constraint is
-- dropped, so the table is never without a uniqueness guarantee.
--
-- Existing rows default to 'sent' and keep their read_at; marking the 23
-- historic unread rows read is left to the owner.
-- ============================================================================

alter table public.reporter_notifications
  add column if not exists status text not null default 'sent',
  add column if not exists body_override text,
  add column if not exists released_by uuid,
  add column if not exists released_at timestamptz,
  add column if not exists dedupe_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reporter_notifications_status_check') then
    alter table public.reporter_notifications
      add constraint reporter_notifications_status_check
      check (status in ('held', 'sent', 'discarded'));
  end if;

  -- Every type a writer emits today (createNotification's NotificationType,
  -- the comment trigger, the duplicate-follow trigger) plus the console's
  -- legacy filter values. A writer whose type is missing here would fail its
  -- insert, so this list is pinned to NotificationType by a contract test.
  if not exists (select 1 from pg_constraint where conname = 'reporter_notifications_type_check') then
    alter table public.reporter_notifications
      add constraint reporter_notifications_type_check
      check (notification_type in (
        'classified', 'reviewing', 'confirmed', 'fix_started', 'fixed', 'released',
        'verified', 'reopened', 'dismissed', 'closed', 'duplicate_linked',
        'info_requested', 'comment_reply', 'points_awarded', 'admin_message_seen',
        'fix_failed', 'reward'
      ));
  end if;
end $$;

create unique index if not exists reporter_notifications_dedupe_uidx
  on public.reporter_notifications (report_id, notification_type, dedupe_key)
  where dedupe_key is not null;

create index if not exists reporter_notifications_held_idx
  on public.reporter_notifications (project_id, created_at desc)
  where status = 'held';

alter table public.notification_deliveries
  add column if not exists dedupe_key text;

create unique index if not exists notification_deliveries_dedupe_uidx
  on public.notification_deliveries (report_id, notification_type, channel, coalesce(dedupe_key, ''));

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_report_id_notification_type_channel_key;

comment on column public.reporter_notifications.status is
  'held = waiting in the review-mode outbox; sent = visible to the reporter; discarded = never shown.';
comment on column public.reporter_notifications.dedupe_key is
  'Distinguishes rows of one (report, type): comment id, canonical report id, release id or follower key.';

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
