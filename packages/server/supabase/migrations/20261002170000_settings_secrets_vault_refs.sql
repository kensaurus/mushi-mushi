-- Store integration secrets in project_settings as Vault references only.
--
-- DATA MIGRATION + VALUE SWITCH. Apply AFTER the `api` edge function from the
-- same change is deployed: that build writes `github_webhook_secret` and
-- `sentry_webhook_secret` as `vault://` refs and dereferences every column
-- below. The build running before it writes `github_webhook_secret` raw, and
-- the CHECK constraints added here would reject that write.
--
-- What it does, per column, for every value that is not already `vault://…`:
--   1. vault_store_secret(<deterministic name>, <value>) — upserts by name.
--   2. Replace the column with `vault://<name>`.
-- Names follow the API's convention so later console saves update the same
-- Vault secret in place:
--   project_settings:                 mushi/integration/<project_id>/<kind>/<column>
--   organization_integration_settings: mushi/org-integration/<org_id>/<kind>/<column>
-- Values already stored as `vault://…` are left as they are, so re-running is a
-- no-op. Empty strings become NULL. Nothing here logs or returns a value.
--
-- Then CHECK constraints make a plaintext value impossible to store again in
-- these columns: `col IS NULL OR col LIKE 'vault://%'`.
--
-- regen_webhook_url is NOT converted: it is a plain endpoint URL (no query
-- string, no credentials) and the signature secret lives in regen_webhook_secret.
--
-- Operators who configure the regen webhook by SQL (there is no console form):
--   select public.vault_store_secret(
--     'mushi/integration/<project_id>/content_quality/regen_webhook_secret', '<secret>');
--   update public.project_settings
--      set regen_webhook_secret = 'vault://mushi/integration/<project_id>/content_quality/regen_webhook_secret'
--    where project_id = '<project_id>';
--
-- Verification (counts and booleans only — every row must read 0 / true):
--   -- 1. no plaintext left
--   select count(*) filter (where github_installation_token_ref not like 'vault://%') as gh_token,
--          count(*) filter (where github_webhook_secret         not like 'vault://%') as gh_whsec,
--          count(*) filter (where sentry_webhook_secret         not like 'vault://%') as sentry_whsec,
--          count(*) filter (where regen_webhook_secret          not like 'vault://%') as regen_whsec,
--          count(*) filter (where github_deploy_key             not like 'vault://%') as gh_deploy_key
--     from public.project_settings;
--   -- 2. every ref resolves (0 dangling per column)
--   select col, count(*) filter (where public.vault_lookup(substr(v, 9)) is null) as dangling
--     from (select 'github_installation_token_ref' col, github_installation_token_ref v from public.project_settings
--           union all select 'github_webhook_secret', github_webhook_secret from public.project_settings
--           union all select 'sentry_webhook_secret', sentry_webhook_secret from public.project_settings
--           union all select 'regen_webhook_secret',  regen_webhook_secret  from public.project_settings
--           union all select 'github_deploy_key',     github_deploy_key     from public.project_settings) s
--    where v is not null group by col;
--   -- 3. the guards exist (expect 9)
--   select count(*) from pg_constraint
--    where conname like '%\_is\_vault\_ref' escape '\'
--      and conrelid in ('public.project_settings'::regclass, 'public.organization_integration_settings'::regclass);

DO $$
DECLARE
  -- column => Vault kind segment (matches VAULTED_FIELDS_BY_KIND in api/routes/integrations.ts)
  project_cols CONSTANT text[][] := ARRAY[
    ARRAY['github_installation_token_ref', 'github'],
    ARRAY['github_webhook_secret',         'github'],
    ARRAY['github_deploy_key',             'github'],
    ARRAY['sentry_webhook_secret',         'sentry'],
    ARRAY['regen_webhook_secret',          'content_quality']
  ];
  org_cols CONSTANT text[][] := ARRAY[
    ARRAY['github_installation_token_ref', 'github'],
    ARRAY['github_webhook_secret',         'github'],
    ARRAY['github_deploy_key',             'github'],
    ARRAY['sentry_webhook_secret',         'sentry']
  ];
  i int;
  col text;
  kind text;
  r record;
  secret_name text;
BEGIN
  FOR i IN 1 .. array_length(project_cols, 1) LOOP
    col  := project_cols[i][1];
    kind := project_cols[i][2];
    EXECUTE format('UPDATE public.project_settings SET %1$I = NULL WHERE %1$I = %2$L', col, '');
    FOR r IN EXECUTE format(
      'SELECT project_id::text AS owner_id, %1$I AS v FROM public.project_settings
        WHERE %1$I IS NOT NULL AND %1$I NOT LIKE %2$L',
      col, 'vault://%')
    LOOP
      secret_name := format('mushi/integration/%s/%s/%s', r.owner_id, kind, col);
      PERFORM public.vault_store_secret(secret_name, r.v);
      EXECUTE format('UPDATE public.project_settings SET %I = $1 WHERE project_id = $2::uuid', col)
        USING 'vault://' || secret_name, r.owner_id;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. array_length(org_cols, 1) LOOP
    col  := org_cols[i][1];
    kind := org_cols[i][2];
    EXECUTE format('UPDATE public.organization_integration_settings SET %1$I = NULL WHERE %1$I = %2$L', col, '');
    FOR r IN EXECUTE format(
      'SELECT organization_id::text AS owner_id, %1$I AS v FROM public.organization_integration_settings
        WHERE %1$I IS NOT NULL AND %1$I NOT LIKE %2$L',
      col, 'vault://%')
    LOOP
      secret_name := format('mushi/org-integration/%s/%s/%s', r.owner_id, kind, col);
      PERFORM public.vault_store_secret(secret_name, r.v);
      EXECUTE format('UPDATE public.organization_integration_settings SET %I = $1 WHERE organization_id = $2::uuid', col)
        USING 'vault://' || secret_name, r.owner_id;
    END LOOP;
  END LOOP;
END
$$;

-- Guards: a plaintext secret can no longer be stored in these columns. A writer
-- that forgets to vault fails loudly (23514) instead of persisting the secret.
ALTER TABLE public.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_github_installation_token_ref_is_vault_ref,
  ADD CONSTRAINT project_settings_github_installation_token_ref_is_vault_ref
    CHECK (github_installation_token_ref IS NULL OR github_installation_token_ref LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS project_settings_github_webhook_secret_is_vault_ref,
  ADD CONSTRAINT project_settings_github_webhook_secret_is_vault_ref
    CHECK (github_webhook_secret IS NULL OR github_webhook_secret LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS project_settings_github_deploy_key_is_vault_ref,
  ADD CONSTRAINT project_settings_github_deploy_key_is_vault_ref
    CHECK (github_deploy_key IS NULL OR github_deploy_key LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS project_settings_sentry_webhook_secret_is_vault_ref,
  ADD CONSTRAINT project_settings_sentry_webhook_secret_is_vault_ref
    CHECK (sentry_webhook_secret IS NULL OR sentry_webhook_secret LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS project_settings_regen_webhook_secret_is_vault_ref,
  ADD CONSTRAINT project_settings_regen_webhook_secret_is_vault_ref
    CHECK (regen_webhook_secret IS NULL OR regen_webhook_secret LIKE 'vault://%');

ALTER TABLE public.organization_integration_settings
  DROP CONSTRAINT IF EXISTS org_settings_github_installation_token_ref_is_vault_ref,
  ADD CONSTRAINT org_settings_github_installation_token_ref_is_vault_ref
    CHECK (github_installation_token_ref IS NULL OR github_installation_token_ref LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS org_settings_github_webhook_secret_is_vault_ref,
  ADD CONSTRAINT org_settings_github_webhook_secret_is_vault_ref
    CHECK (github_webhook_secret IS NULL OR github_webhook_secret LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS org_settings_github_deploy_key_is_vault_ref,
  ADD CONSTRAINT org_settings_github_deploy_key_is_vault_ref
    CHECK (github_deploy_key IS NULL OR github_deploy_key LIKE 'vault://%'),
  DROP CONSTRAINT IF EXISTS org_settings_sentry_webhook_secret_is_vault_ref,
  ADD CONSTRAINT org_settings_sentry_webhook_secret_is_vault_ref
    CHECK (sentry_webhook_secret IS NULL OR sentry_webhook_secret LIKE 'vault://%');
