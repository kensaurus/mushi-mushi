-- Public SDK configuration that may be fetched by installed customer apps.
-- Only non-secret presentation/capture knobs live here; API keys stay in
-- project_api_keys and BYOK/integration secrets stay vaulted.

alter table public.project_settings
  add column if not exists sdk_config_enabled boolean not null default true,
  add column if not exists sdk_widget_position text not null default 'bottom-right',
  add column if not exists sdk_widget_theme text not null default 'auto',
  add column if not exists sdk_widget_trigger_text text,
  add column if not exists sdk_capture_console boolean not null default true,
  add column if not exists sdk_capture_network boolean not null default true,
  add column if not exists sdk_capture_performance boolean not null default false,
  add column if not exists sdk_capture_screenshot text not null default 'on-report',
  add column if not exists sdk_capture_element_selector boolean not null default false,
  add column if not exists sdk_native_trigger_mode text not null default 'both',
  add column if not exists sdk_min_description_length integer not null default 20,
  add column if not exists sdk_config_updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_widget_position_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_widget_position_check
      check (sdk_widget_position in ('top-left', 'top-right', 'bottom-left', 'bottom-right'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_widget_theme_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_widget_theme_check
      check (sdk_widget_theme in ('auto', 'light', 'dark'));
  end if;

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

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_capture_screenshot_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_capture_screenshot_check
      check (sdk_capture_screenshot in ('on-report', 'auto', 'off'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_native_trigger_mode_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_native_trigger_mode_check
      check (sdk_native_trigger_mode in ('shake', 'button', 'both', 'none'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_settings_sdk_min_description_length_check'
      and conrelid = 'public.project_settings'::regclass
  ) then
    alter table public.project_settings
      add constraint project_settings_sdk_min_description_length_check
      check (sdk_min_description_length between 0 and 1000);
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

comment on column public.project_settings.sdk_config_enabled is
  'Public SDK runtime-config flag. When false, clients keep local defaults and hide runtime-config-driven affordances.';
comment on column public.project_settings.sdk_widget_position is
  'Public web widget corner used by SDK runtime config.';
comment on column public.project_settings.sdk_widget_theme is
  'Public web widget theme override used by SDK runtime config.';
comment on column public.project_settings.sdk_widget_trigger_text is
  'Optional public web widget trigger text. Null means the SDK default.';
comment on column public.project_settings.sdk_native_trigger_mode is
  'Public native trigger mode for Capacitor/iOS/Android SDKs.';
comment on column public.project_settings.sdk_config_updated_at is
  'Bumped whenever SDK runtime config changes; clients use it as a lightweight version.';
