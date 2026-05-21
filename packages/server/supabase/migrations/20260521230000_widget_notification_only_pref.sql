-- Migration: widget_notification_only_pref
-- Phase 1.6 (bell-only mode) + Phase 5.3
--
-- Adds `widget_hide_routes_mode` to `project_settings` so the console-persisted
-- widget preference is stored server-side instead of being hard-coded in the
-- host app's `MushiProvider` config.
--
-- Values:
--   'all'          (default) — both the trigger button and the badge are hidden
--                             on matching hideOnRoutes patterns.
--   'trigger-only' — the trigger button is hidden but the unread-reply badge
--                   keeps rendering. The SDK switches to 'notification-only'
--                   mode automatically when there are unread replies.
--
-- The web SDK (@mushi-mushi/web ≥1.5.0) reads this value from the runtime
-- config endpoint and applies it locally — no host-app config change needed
-- when the default is sufficient.

alter table project_settings
  add column if not exists widget_hide_routes_mode text
    check (widget_hide_routes_mode in ('all', 'trigger-only'))
    default 'all';

comment on column project_settings.widget_hide_routes_mode is
  'Controls what is hidden when the current route matches hideOnRoutes. '
  '''all'' hides both the trigger and the badge (default). '
  '''trigger-only'' hides only the trigger button; the unread-reply badge keeps '
  'rendering and opens the reporter panel when tapped (bell-only mode).';

-- Also store the Supabase project ref so the admin console can use the
-- Supabase MCP for live schema/advisor data (Phase 5.1).
alter table project_settings
  add column if not exists supabase_project_ref text;

comment on column project_settings.supabase_project_ref is
  'Supabase project ref (e.g. xyzabcdef). Used by the admin console to call '
  'the Supabase MCP (read-only) for schema introspection and advisor data. '
  'Only relevant when the project is deployed on Supabase.';
