-- ============================================================================
-- 20261020154405_site_watch_unconfirmed_and_flapping
--
-- Live-site watch (ADR 0029, review follow-up to
-- 20261020152752_site_watch_confirm_before_filing). Three more columns on
-- site_watch_pages:
--
--   judge_fail_open      the suspect was only ever named by a judge that
--                        failed open ("defaulting to meaningful", or low
--                        confidence); such a suspect files only through a
--                        confirm scrape that reproduces the break
--   inconclusive_checks  checks in which every confirm scrape of a confident
--                        judged suspect was inconclusive; at 2 it files at
--                        low severity, marked unconfirmed
--   flap_dismissals      when a confirm scrape found a 5xx suspect healthy
--                        (ISO timestamps, last 7 days); the 3rd within 7 days
--                        files at low severity as intermittent. Kept when the
--                        row is reopened.
--
-- ADDITIVE: new columns with defaults. No data changes.
-- Apply BEFORE deploying the api and site-watch-poll functions.
-- ============================================================================

alter table public.site_watch_pages
  add column if not exists judge_fail_open boolean not null default false,
  add column if not exists inconclusive_checks integer not null default 0,
  add column if not exists flap_dismissals jsonb not null default '[]'::jsonb;

comment on column public.site_watch_pages.judge_fail_open is
  'True while the suspect was only named by a judge that failed open; it then files only through a confirm scrape (ADR 0029).';
comment on column public.site_watch_pages.inconclusive_checks is
  'Checks in which the confirm scrapes of a confident judged suspect were all inconclusive; 2 files it at low severity, unconfirmed (ADR 0029).';
comment on column public.site_watch_pages.flap_dismissals is
  'ISO timestamps (last 7 days) when a confirm scrape found this 5xx healthy; the 3rd files it at low severity as intermittent (ADR 0029).';
