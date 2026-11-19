-- =============================================================================
-- 20261119100000_hosted_schema_parity
--
-- The hosted database has 24 columns that no migration created (added by hand
-- or by migrations that were edited after they ran). A database built from
-- these files alone (self-host, CI's from-scratch install) lacked them, so
-- minting an API key failed (project_api_keys.key_prefix) and fix tracking,
-- Langfuse links and Sentry ids had nowhere to go.
--
-- Found by diffing information_schema.columns of the hosted project against a
-- fresh replay on 2026-11-19. Every statement is IF NOT EXISTS or guarded, so
-- on the hosted database this migration changes nothing.
-- =============================================================================

alter table public.classification_evaluations
  add column if not exists langfuse_trace_id text;

alter table public.fix_attempts
  add column if not exists langfuse_trace_id text,
  add column if not exists pr_number integer,
  add column if not exists check_run_status text,
  add column if not exists check_run_conclusion text,
  add column if not exists check_run_updated_at timestamptz,
  add column if not exists llm_model text,
  add column if not exists llm_input_tokens integer,
  add column if not exists llm_output_tokens integer,
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

-- NOT NULL as on hosted, once no row lacks a prefix (keys minted before this
-- column existed on a self-hosted install cannot have one).
do $$
begin
  if not exists (select 1 from public.project_api_keys where key_prefix is null) then
    alter table public.project_api_keys alter column key_prefix set not null;
  end if;
end $$;

alter table public.project_settings
  add column if not exists provider text not null default 'anthropic',
  add column if not exists report_retention_days integer not null default 90,
  add column if not exists langfuse_host text,
  add column if not exists langfuse_public_key_ref text,
  add column if not exists langfuse_secret_key_ref text,
  add column if not exists github_default_branch text;

alter table public.reports
  add column if not exists sentry_event_id text,
  add column if not exists sentry_replay_id text;

alter table public.tester_kyc
  add column if not exists ytd_gift_card_usd numeric(10,2) not null default 0;

-- Hosted stores reports.confidence as double precision; the initial schema
-- said real. Align a fresh database only (no table rewrite on hosted).
do $$
begin
  if (select format_type(atttypid, atttypmod) from pg_attribute
       where attrelid = 'public.reports'::regclass and attname = 'confidence') = 'real' then
    alter table public.reports alter column confidence type double precision;
  end if;
end $$;
