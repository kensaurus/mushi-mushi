-- ============================================================================
-- 20261021120000_site_watch_confirm_before_filing
--
-- Live-site watch (ADR 0024, amended by ADR 0029). A page a check finds
-- broken is now a SUSPECT. It files only when a confirm scrape loads it again
-- and it is still broken, or, for an HTTP error or a load failure, when the
-- next check sees it failing too. 9 of 23 site-watch reports sent to coding
-- agents in October 2026 were pages that were fine.
--
--   confirmed_at          null while the row is a suspect; set when its
--                         report is filed (the filing claim)
--   fail_streak           consecutive checks that measured it failing
--   last_failed_check_id  the check last counted, so two polls reading the
--                         same check count it once
--   confirm_attempts      confirm scrapes since that check; also the
--                         compare-and-set claim for the next confirm scrape
--   last_confirm_at       when the last confirm scrape started
--   last_confirm          what it saw: {outcome, detail, statusCode, at}
--
-- ADDITIVE: new columns with defaults and one partial index. Every row that
-- exists already was filed under the old rule, so confirmed_at is backfilled
-- from first_seen_at: those findings stay filed, as they are today.
-- Apply BEFORE deploying the api and site-watch-poll functions: both read
-- confirmed_at.
-- ============================================================================

alter table public.site_watch_pages
  add column if not exists confirmed_at timestamptz,
  add column if not exists fail_streak integer not null default 0,
  add column if not exists last_failed_check_id text,
  add column if not exists confirm_attempts integer not null default 0,
  add column if not exists last_confirm_at timestamptz,
  add column if not exists last_confirm jsonb;

update public.site_watch_pages
   set confirmed_at = first_seen_at
 where confirmed_at is null;

comment on column public.site_watch_pages.confirmed_at is
  'When the page was seen failing a second time and its report filed (ADR 0029). Null while the row is a suspect.';
comment on column public.site_watch_pages.fail_streak is
  'Consecutive checks that measured the page failing (HTTP error or load failure). Two file it when no confirm scrape was conclusive.';
comment on column public.site_watch_pages.confirm_attempts is
  'Confirm scrapes since the last check that saw the page failing; the compare-and-set claim for the next one.';
comment on column public.site_watch_pages.last_confirm is
  'The last confirm scrape: {outcome: broken | healthy | inconclusive, detail, statusCode, at}.';

create index if not exists idx_site_watch_pages_suspects
  on public.site_watch_pages (watch_id)
  where resolved_at is null and confirmed_at is null;
