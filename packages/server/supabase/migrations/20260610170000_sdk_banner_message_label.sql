-- Migration: sdk_banner_message_label
-- Rich banner strip copy (admin BetaBanner parity) configurable per project.

alter table public.project_settings
  add column if not exists sdk_banner_message text,
  add column if not exists sdk_banner_label   text;

comment on column public.project_settings.sdk_banner_message is
  'Body copy on the SDK header banner when launcher is banner (rich layout).';
comment on column public.project_settings.sdk_banner_label is
  'Pill label before banner message (e.g. Beta). Null = SDK default.';
