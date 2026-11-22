-- Widget brand colour from the console, and the `inherit` theme (2026-11-22).
--
-- sdk_widget_accent: the widget's accent colour (Send button, focus rings, the
-- launcher's underline) as a lowercase `#rrggbb`. NULL = auto: the widget
-- keeps matching the host page (`--mushi-accent`, `accent-color`, its own
-- default). Served as `widget.accent` by GET /v1/sdk/config only when set,
-- with `widget.accentText` (black or white, whichever reads better on it; the
-- server never serves a pair under 3:1, _shared/sdk-config.ts accentInk).
-- An accent the host app sets in code still wins over this column
-- (packages/web/src/runtime-merge.ts).
--
-- sdk_widget_theme gains 'inherit' (follow the host page's own light/dark
-- marker), which the SDK has supported since MushiWidgetConfig.theme grew it;
-- the console could not store it because of the original check constraint
-- (20260426004656_sdk_public_config.sql).
--
-- Additive: the API reads the column with a fallback select while this
-- migration is pending, so apply it before or after deploying `api`.
--
-- Verify:
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_name = 'project_settings' and column_name = 'sdk_widget_accent';  -- text, YES
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname in ('project_settings_sdk_widget_accent_check', 'project_settings_sdk_widget_theme_check');

alter table public.project_settings
  add column if not exists sdk_widget_accent text;

alter table public.project_settings
  drop constraint if exists project_settings_sdk_widget_accent_check;
alter table public.project_settings
  add constraint project_settings_sdk_widget_accent_check
  check (sdk_widget_accent is null or sdk_widget_accent ~ '^#[0-9a-f]{6}$');

alter table public.project_settings
  drop constraint if exists project_settings_sdk_widget_theme_check;
alter table public.project_settings
  add constraint project_settings_sdk_widget_theme_check
  check (sdk_widget_theme in ('auto', 'light', 'dark', 'inherit'));

-- Keep the SDK-config version bump in step: a direct SQL edit of the accent
-- also advances sdk_config_updated_at (the API PUT sets it explicitly).
create or replace function public.touch_project_settings_sdk_config_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if row(
    new.sdk_config_enabled,
    new.sdk_widget_position,
    new.sdk_widget_theme,
    new.sdk_widget_trigger_text,
    new.sdk_capture_console,
    new.sdk_capture_network,
    new.sdk_capture_performance,
    new.sdk_capture_screenshot,
    new.sdk_capture_element_selector,
    new.sdk_native_trigger_mode,
    new.sdk_min_description_length,
    new.sdk_screenshot_sensitive_hint,
    new.sdk_widget_accent
  ) is distinct from row(
    old.sdk_config_enabled,
    old.sdk_widget_position,
    old.sdk_widget_theme,
    old.sdk_widget_trigger_text,
    old.sdk_capture_console,
    old.sdk_capture_network,
    old.sdk_capture_performance,
    old.sdk_capture_screenshot,
    old.sdk_capture_element_selector,
    old.sdk_native_trigger_mode,
    old.sdk_min_description_length,
    old.sdk_screenshot_sensitive_hint,
    old.sdk_widget_accent
  ) then
    new.sdk_config_updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists project_settings_sdk_config_updated_at_touch on public.project_settings;
create trigger project_settings_sdk_config_updated_at_touch
  before update of
    sdk_config_enabled,
    sdk_widget_position,
    sdk_widget_theme,
    sdk_widget_trigger_text,
    sdk_capture_console,
    sdk_capture_network,
    sdk_capture_performance,
    sdk_capture_screenshot,
    sdk_capture_element_selector,
    sdk_native_trigger_mode,
    sdk_min_description_length,
    sdk_screenshot_sensitive_hint,
    sdk_widget_accent
  on public.project_settings
  for each row
  execute function public.touch_project_settings_sdk_config_updated_at();

comment on column public.project_settings.sdk_widget_accent is
  'Widget accent colour set in the console, lowercase #rrggbb. NULL = auto (match the host site). Served as widget.accent (+ widget.accentText, black or white) in GET /v1/sdk/config; an accent set in the host app''s code wins.';
