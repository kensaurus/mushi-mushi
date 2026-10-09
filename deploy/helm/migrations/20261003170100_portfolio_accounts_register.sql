-- ============================================================================
-- 20261003170100_portfolio_accounts_register
--
-- Plan 020 §11: the accounts and resilience register on /portfolio.
-- ADDITIVE: apply BEFORE deploying the api and recipe-collector functions.
--
-- Each account the portfolio depends on (Apple, Google Play, AWS, Supabase
-- organization, Vercel, the domain registrar, Stripe, …) becomes a
-- portfolio_resources row of kind 'account'. Names and metadata only, never a
-- secret: the api secret-scans every field before it is stored.
--
--   kind 'account'          added to the kind CHECK (rebuilt as a named
--                           constraint: the original was inline and unnamed)
--   display_name            the account's name as the owner knows it
--   account_provider        apple | google_play | aws | supabase | vercel |
--                           registrar | stripe | github | cloudflare | other
--   owner_email             who owns it
--   two_factor_declared     the owner says 2FA is on (Mushi cannot check)
--   recovery_contact        a second person who can get in
--   admin_count             people who can sign in as owner or admin (default 1)
--   auto_renew              registrar accounts and domains: auto-renew declared on
--
-- Rules (computed by the api and the daily org collector, written to
-- portfolio_findings): account_single_owner, registrar_autorenew_off.
--
-- Verify after apply:
--   insert into public.portfolio_resources (organization_id, kind, external_id, account_provider)
--     values ('<org uuid>', 'account', 'apple:test', 'apple');            -- succeeds (then delete it)
--   insert ... (kind 'account', account_provider null)                    -- fails: portfolio_resources_account_provider_required
--   select conname from pg_constraint where conrelid = 'public.portfolio_resources'::regclass and contype = 'c';
--     -- portfolio_resources_kind_valid present, no other kind check left
-- ============================================================================

-- The original kind CHECK was declared inline, so its name is whatever Postgres
-- generated. Find every CHECK on this table that constrains `kind` (except the
-- named ones this migration owns) and replace it with one named constraint.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.portfolio_resources'::regclass
       and contype = 'c'
       and conname not in ('portfolio_resources_kind_valid', 'portfolio_resources_account_provider_required',
                           'portfolio_resources_account_provider_valid', 'portfolio_resources_owner_email_valid',
                           'portfolio_resources_recovery_contact_len', 'portfolio_resources_display_name_len',
                           'portfolio_resources_admin_count_range')
       and pg_get_constraintdef(oid) ~ '\mkind\M'
  loop
    execute format('alter table public.portfolio_resources drop constraint %I', c.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_kind_valid') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_kind_valid check (kind in (
        'auth_provider', 'supabase_project', 'stripe_account', 'domain', 'deep_link_domain', 'bundle_id',
        'push_channel', 'slack_channel', 'posthog_project', 'sentry_project', 'repo', 'legacy_system',
        'revenuecat_project', 'account'
      ));
  end if;
end $$;

alter table public.portfolio_resources
  add column if not exists display_name text,
  add column if not exists account_provider text,
  add column if not exists owner_email text,
  add column if not exists two_factor_declared boolean,
  add column if not exists recovery_contact text,
  add column if not exists admin_count smallint not null default 1,
  add column if not exists auto_renew boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_account_provider_valid') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_account_provider_valid check (account_provider is null or account_provider in (
        'apple', 'google_play', 'aws', 'supabase', 'vercel', 'registrar', 'stripe', 'github', 'cloudflare', 'other'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_account_provider_required') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_account_provider_required check (kind <> 'account' or account_provider is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_owner_email_valid') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_owner_email_valid
      check (owner_email is null or (char_length(owner_email) between 3 and 254 and owner_email like '%_@_%'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_recovery_contact_len') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_recovery_contact_len check (recovery_contact is null or char_length(recovery_contact) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_display_name_len') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_display_name_len check (display_name is null or char_length(display_name) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portfolio_resources_admin_count_range') then
    alter table public.portfolio_resources
      add constraint portfolio_resources_admin_count_range check (admin_count between 1 and 100);
  end if;
end $$;

create index if not exists portfolio_resources_org_accounts
  on public.portfolio_resources (organization_id)
  where kind = 'account';

comment on column public.portfolio_resources.two_factor_declared is
  'Plan 020 §11: what the owner declared. Mushi cannot see the provider''s 2FA setting.';
comment on column public.portfolio_resources.auto_renew is
  'Plan 020 §11: auto-renew as declared by the owner for a registrar account or a domain; null = not declared.';

notify pgrst, 'reload schema';
