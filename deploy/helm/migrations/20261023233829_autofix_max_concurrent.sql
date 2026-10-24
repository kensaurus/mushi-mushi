-- Agents running at once per app (spend-down), for apps whose CI is slow or
-- runs on a shared machine: every agent push runs the host's PR CI.
-- NULL keeps the default of 3 (SPEND_DOWN_MAX_OPEN_PER_PROJECT).
alter table public.project_settings
  add column if not exists autofix_max_concurrent integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_settings_autofix_max_concurrent_check') then
    alter table public.project_settings add constraint project_settings_autofix_max_concurrent_check
      check (autofix_max_concurrent is null or autofix_max_concurrent between 1 and 10);
  end if;
end $$;

comment on column public.project_settings.autofix_max_concurrent is
  'Cloud agents spend-down runs at once for this app; NULL = 3. Lower it where every agent push runs slow or shared CI.';
