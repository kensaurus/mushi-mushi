-- Anti-gaming: an unflag now sticks.
-- The multi-account check flagged a device once its reporter_tokens array
-- held more than 3 tokens, and unflag only cleared the flag. The array kept
-- every token, so the next report from that device re-flagged it at once.
-- reviewed_token_count records how many tokens a person had already seen
-- when they unflagged; the checks count only tokens added after that.
alter table public.reporter_devices
  add column if not exists reviewed_token_count integer not null default 0;

comment on column public.reporter_devices.reviewed_token_count is
  'Reporter tokens on this device when a person last unflagged it. Multi- and cross-account checks count only tokens added since.';

-- library-modernizer filed its notices before it set reports.source, so they
-- show as widget reports from users. Same rows the cron files from now on.
update public.reports
   set source = 'library_modernizer'
 where reporter_token_hash = 'cron:library-modernizer'
   and source = 'widget';
