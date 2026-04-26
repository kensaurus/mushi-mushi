-- Hardening repair for SDK runtime config after the initial cloud migration.
-- The original migration is already applied in hosted projects, so keep these
-- fixes in a separate idempotent migration instead of editing history only.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_trigger_text_length_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_trigger_text_length_check
      check (sdk_widget_trigger_text is null or char_length(sdk_widget_trigger_text) <= 24);
  end if;
end $$;

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
    new.sdk_min_description_length
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
    old.sdk_min_description_length
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
    sdk_min_description_length
  on public.project_settings
  for each row
  execute function public.touch_project_settings_sdk_config_updated_at();
