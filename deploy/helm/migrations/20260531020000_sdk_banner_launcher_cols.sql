-- Migration: sdk_banner_launcher_cols
-- Adds launcher-mode + banner-configuration columns to project_settings.
-- These columns power the new `trigger: 'banner'` SDK mode — a slim, full-width
-- header strip that replaces the floating action button as the default launcher.

alter table project_settings
  add column if not exists sdk_widget_launcher  text    default 'auto',
  add column if not exists sdk_banner_variant   text    default 'brand',
  add column if not exists sdk_banner_position  text    default 'top',
  add column if not exists sdk_banner_bug_cta   text,
  add column if not exists sdk_banner_feature_cta boolean default true;

-- Constrain to valid values at the DB level so bad API payloads can't corrupt config.
alter table project_settings
  add constraint sdk_widget_launcher_check
    check (sdk_widget_launcher in ('auto', 'banner', 'edge-tab', 'manual', 'hidden')),
  add constraint sdk_banner_variant_check
    check (sdk_banner_variant in ('neon', 'brand', 'subtle')),
  add constraint sdk_banner_position_check
    check (sdk_banner_position in ('top', 'bottom'));
