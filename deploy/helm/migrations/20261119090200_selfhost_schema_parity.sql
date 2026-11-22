-- Self-host schema parity (2026-11-19). A fresh install built from these migrations was
-- missing 24 columns that hosted gained outside the migration files (found by diffing
-- information_schema.columns on hosted against a fresh docker-compose database after every
-- migration applied). The code reads several of them (fix_attempts.pr_number and check_run_*,
-- project_api_keys.key_prefix and revoked_at, reports.sentry_*). Types, defaults and
-- nullability are copied from hosted; on hosted every statement here is a no-op.

alter table public.classification_evaluations
  add column if not exists langfuse_trace_id text;

alter table public.fix_attempts
  add column if not exists check_run_conclusion text,
  add column if not exists check_run_status text,
  add column if not exists check_run_updated_at timestamptz,
  add column if not exists langfuse_trace_id text,
  add column if not exists llm_input_tokens integer,
  add column if not exists llm_model text,
  add column if not exists llm_output_tokens integer,
  add column if not exists pr_number integer,
  add column if not exists rationale text;

alter table public.llm_invocations
  add column if not exists langfuse_trace_id text;

alter table public.pdca_runs
  add column if not exists error_detail text;

alter table public.plugin_registry
  add column if not exists version text not null default '1.0.0';

alter table public.project_api_keys
  add column if not exists key_prefix text,
  add column if not exists revoked_at timestamptz;

-- Hosted has key_prefix NOT NULL with no default. Every insert path writes it, but an
-- existing self-host database may hold older rows, so tighten only when none is null.
do $$
begin
  if not exists (select 1 from public.project_api_keys where key_prefix is null) then
    alter table public.project_api_keys alter column key_prefix set not null;
  end if;
end $$;

alter table public.project_settings
  add column if not exists github_default_branch text,
  add column if not exists langfuse_host text,
  add column if not exists langfuse_public_key_ref text,
  add column if not exists langfuse_secret_key_ref text,
  add column if not exists provider text not null default 'anthropic',
  add column if not exists report_retention_days integer not null default 90;

alter table public.reports
  add column if not exists sentry_event_id text,
  add column if not exists sentry_replay_id text;

alter table public.tester_kyc
  add column if not exists ytd_gift_card_usd numeric(10,2) not null default 0;

-- A new project's owner becomes its first member. Hosted has this AFTER INSERT trigger (and
-- a redundant second one) from outside the migrations; without it a self-hosted project
-- would not list its own creator, and member-scoped RLS would lock them out of the app.
-- Definition and grants copied from hosted (SECURITY DEFINER, so RLS on project_members
-- does not block the insert).
create or replace function public.project_members_autoadd_owner()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  if new.owner_id is not null then
    insert into project_members (project_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function public.project_members_autoadd_owner() from public, anon, authenticated;
grant execute on function public.project_members_autoadd_owner() to service_role;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.projects'::regclass and not tgisinternal
      and tgfoid in ('public.project_members_autoadd_owner()'::regprocedure)
         or (tgrelid = 'public.projects'::regclass and tgname = 'trg_seed_project_member_for_owner')
  ) then
    create trigger trg_projects_autoadd_owner
      after insert on public.projects
      for each row execute function public.project_members_autoadd_owner();
  end if;
end $$;
