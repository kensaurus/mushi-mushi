-- ============================================================================
-- 20261003180100_digest_channels_and_store_review_intake
--
-- ADDITIVE: apply BEFORE deploying the api, operator-digest and
-- store-review-intake functions from the same change (they read and write
-- these columns). The new channels and the store intake are off by default.
-- The weekly line defaults to Monday, but it only appears in a digest the
-- organization already switched on, and only when the team set up a funnel.
--
-- Gap #23 (notifications):
--   1. operator_digest_settings gains Discord, Teams and Telegram channels.
--      Each names a project whose already-configured webhook (Discord,
--      Teams) or bound Telegram chats receive the digest, exactly like the
--      existing slack_project_id. gtm_weekday is the UTC weekday (0 = Sunday)
--      the weekly signups/activations line per app rides along; null = never.
--   2. reports.source accepts 'store_review' (appended to the live list,
--      never restated).
--   3. Store reviews become reports, per project opt-in:
--      project_settings.store_review_intake_enabled (default false) and
--      store_review_max_rating (default 2 = only 1 and 2 star reviews file a
--      report). store_review_items remembers every review seen, so a review
--      is filed at most once (primary key project, store, review id).
--   4. pg_cron: store-review-intake every 6 hours at :45.
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'operator_digest_settings'
--      and column_name in ('discord_project_id','teams_project_id','telegram_project_id','gtm_weekday'); -- 4
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_source_check'; -- has store_review
--   select relrowsecurity from pg_class where oid = 'public.store_review_items'::regclass;       -- t
--   select jobname, schedule from cron.job where jobname = 'mushi-store-review-intake';
--   -- then run it once and read the log:
--   select mushi.cron_http_post('store-review-intake', '{"trigger":"manual"}'::jsonb, 60000);
-- ============================================================================

-- ── 1. digest channels ──────────────────────────────────────────────────────

alter table public.operator_digest_settings
  add column if not exists discord_project_id uuid references public.projects(id) on delete set null,
  add column if not exists teams_project_id uuid references public.projects(id) on delete set null,
  add column if not exists telegram_project_id uuid references public.projects(id) on delete set null,
  add column if not exists gtm_weekday smallint default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'operator_digest_settings_gtm_weekday_check'
       and conrelid = 'public.operator_digest_settings'::regclass
  ) then
    alter table public.operator_digest_settings
      add constraint operator_digest_settings_gtm_weekday_check
      check (gtm_weekday is null or gtm_weekday between 0 and 6);
  end if;
end $$;

comment on column public.operator_digest_settings.discord_project_id is
  'Post the digest to this project''s Discord webhook (project_settings.discord_webhook_url). Null = no Discord.';
comment on column public.operator_digest_settings.teams_project_id is
  'Post the digest to this project''s Microsoft Teams webhook (project_settings.teams_webhook_url). Null = no Teams.';
comment on column public.operator_digest_settings.telegram_project_id is
  'Send the digest through this project''s Telegram bot to the chats bound to it (telegram_chat_bindings). Null = no Telegram.';
comment on column public.operator_digest_settings.gtm_weekday is
  'UTC weekday (0 = Sunday) on which the digest adds each app''s signups and activations for the past 7 days, from the team funnel. Null = never.';

-- ── 2. reports.source accepts store_review ──────────────────────────────────

-- Append to the live list; never restate it (same approach as 20261002180000).
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['store_review'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_source_check not found; refusing to guess the allowed sources';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_source_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_source_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

COMMENT ON COLUMN public.reports.source IS
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear, store_review (an App Store or Google Play review).';

-- ── 3. store review intake ──────────────────────────────────────────────────

alter table public.project_settings
  add column if not exists store_review_intake_enabled boolean not null default false,
  add column if not exists store_review_max_rating smallint not null default 2,
  add column if not exists store_review_last_pulled_at timestamptz,
  add column if not exists store_review_last_status text,
  add column if not exists store_review_last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'project_settings_store_review_max_rating_check'
       and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_store_review_max_rating_check
      check (store_review_max_rating between 1 and 5);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'project_settings_store_review_last_status_check'
       and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_store_review_last_status_check
      check (store_review_last_status is null or store_review_last_status in ('ok', 'partial', 'failed', 'not_connected'));
  end if;
end $$;

comment on column public.project_settings.store_review_intake_enabled is
  'Opt-in: pull App Store and Google Play reviews through the project''s store connectors and file low-star ones as reports (source store_review). Off by default.';
comment on column public.project_settings.store_review_max_rating is
  'A review files a report when its star rating is at most this. Default 2 (1 and 2 stars); 5 = every review.';

create table if not exists public.store_review_items (
  project_id uuid not null references public.projects(id) on delete cascade,
  store text not null check (store in ('app_store', 'play')),
  review_id text not null check (char_length(review_id) between 1 and 200),
  rating smallint check (rating is null or rating between 1 and 5),
  -- Null when the rating was above the project's threshold (seen, not filed).
  report_id uuid references public.reports(id) on delete set null,
  review_created_at timestamptz,
  seen_at timestamptz not null default now(),
  primary key (project_id, store, review_id)
);
create index if not exists store_review_items_project_seen on public.store_review_items (project_id, seen_at desc);

alter table public.store_review_items enable row level security;

drop policy if exists store_review_items_member_select on public.store_review_items;
create policy store_review_items_member_select
  on public.store_review_items for select
  to authenticated
  using ((select private.is_project_member(project_id)));

drop policy if exists store_review_items_service_write on public.store_review_items;
create policy store_review_items_service_write
  on public.store_review_items for all
  to service_role
  using (true) with check (true);

revoke all on table public.store_review_items from anon;
grant select on table public.store_review_items to authenticated;

comment on table public.store_review_items is
  'Gap #23: every App Store / Google Play review the intake has seen, so each is filed as a report at most once. Review text lives only on the report. Written only by the service role.';

-- ── 4. cron ─────────────────────────────────────────────────────────────────

select cron.schedule('mushi-store-review-intake', '45 */6 * * *',
  $$select mushi.cron_http_post('store-review-intake', jsonb_build_object('trigger', 'cron'), 60000);$$);
