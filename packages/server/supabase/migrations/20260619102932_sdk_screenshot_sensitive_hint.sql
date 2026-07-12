-- Console-configurable screenshot privacy caption for the bug-capture widget.
--
-- The widget can show a short "don't share sensitive information" caption under
-- the screenshot preview before a reporter submits. This column lets operators
-- tune that copy from the admin console without a host rebuild.
--
--   NULL  = use the SDK's localized default caption (caption shown).
--   ''     = hide the caption (GET /v1/sdk/config maps '' → screenshotSensitiveHint:false).
--   other  = custom caption copy (<= 200 chars).
--
-- Surfaces as widget.screenshotSensitiveHint in GET /v1/sdk/config and in the
-- admin SDK config editor (PUT /v1/admin/projects/:id/sdk-config).

alter table public.project_settings
  add column if not exists sdk_screenshot_sensitive_hint text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_screenshot_sensitive_hint_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_screenshot_sensitive_hint_check
      check (
        sdk_screenshot_sensitive_hint is null
        or char_length(sdk_screenshot_sensitive_hint) <= 200
      );
  end if;
end $$;

-- Extend the SDK-config version-bump trigger so direct DB edits to the new
-- column also advance sdk_config_updated_at (the API PUT path already sets it
-- explicitly, but this keeps the catalog honest for console/SQL writes).
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
    new.sdk_screenshot_sensitive_hint
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
    old.sdk_screenshot_sensitive_hint
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
    sdk_screenshot_sensitive_hint
  on public.project_settings
  for each row
  execute function public.touch_project_settings_sdk_config_updated_at();

comment on column public.project_settings.sdk_screenshot_sensitive_hint is
  'Public SDK screenshot privacy caption. NULL = SDK default caption, '''' = hidden (maps to screenshotSensitiveHint:false), other = custom caption copy (<=200 chars). Surfaces as widget.screenshotSensitiveHint in GET /v1/sdk/config.';
