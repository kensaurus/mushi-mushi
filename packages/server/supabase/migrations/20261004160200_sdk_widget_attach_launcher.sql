-- Migration: sdk_widget_attach_launcher
-- The console offers "Attach to my button" (launcher 'attach' + a CSS
-- selector) and the web SDK supports it (`trigger: 'attach'`,
-- `attachToSelector`), but the column CHECK and the server allow-list had no
-- 'attach' and there was no column for the selector, so the choice was
-- dropped on save and the radio jumped back to the FAB (QA bug 121).
--
-- Additive: one nullable column and a widened CHECK. Apply BEFORE deploying
-- the `api` edge function that selects sdk_widget_attach_selector.

alter table project_settings
  add column if not exists sdk_widget_attach_selector text;

alter table project_settings
  drop constraint if exists sdk_widget_launcher_check;

alter table project_settings
  add constraint sdk_widget_launcher_check
    check (sdk_widget_launcher in ('auto', 'banner', 'edge-tab', 'attach', 'manual', 'hidden'));

-- Served verbatim to the SDK on the public config endpoint: keep it short.
alter table project_settings
  drop constraint if exists sdk_widget_attach_selector_len;

alter table project_settings
  add constraint sdk_widget_attach_selector_len
    check (sdk_widget_attach_selector is null or char_length(sdk_widget_attach_selector) <= 200);

comment on column project_settings.sdk_widget_attach_selector is
  'CSS selector of the host button the widget binds to when sdk_widget_launcher = ''attach''. NULL = none.';
