-- AI keys for every app their owner owns: the universal scope (ADR 0031).
--
-- A byok_keys row belonged to one project or one organization (ADR 0023), so
-- one Anthropic key could not serve apps in two organizations: the owner's
-- dogfood organization had a key, the mushi-mushi project lives in another
-- organization, and its agent PR review (ADR 0030) was skipped with
-- `no_anthropic_key`. A row can now belong to a user instead: a universal key
-- serves every app in every organization where that user is an owner.
--
-- Additive: existing rows keep project_id or organization_id and
-- owner_user_id stays null, so every reader that filters on project_id or
-- organization_id sees exactly what it saw before.
--
-- Resolution order (_shared/byok.ts): the app's own keys, its legacy
-- project_settings credential, its organization's shared keys, the universal
-- keys of its organization's owners, the platform key.

alter table public.byok_keys
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

-- Exactly one owner: a project, an organization, or a user.
alter table public.byok_keys drop constraint if exists byok_keys_one_owner_check;
alter table public.byok_keys
  add constraint byok_keys_one_owner_check
  check (num_nonnulls(project_id, organization_id, owner_user_id) = 1);

-- The resolver reads a user's keys per provider by priority; the key list
-- reads all of them, so the index is not limited to active rows.
create index if not exists idx_byok_keys_owner_user_ordered
  on public.byok_keys (owner_user_id, provider_slug, priority)
  where owner_user_id is not null;

-- The owner sees their own universal keys. Nobody else does: the project and
-- organization member policies match on project_id / organization_id, which
-- are null on a universal row, so a co-owner or member never reads the row or
-- its vault_secret_id. Writes stay service-role only (byok_keys_service_write);
-- the API checks that the console user is the key's owner before any change.
drop policy if exists byok_keys_universal_owner_select on public.byok_keys;
create policy byok_keys_universal_owner_select on public.byok_keys
  for select to authenticated
  using (owner_user_id is not null and owner_user_id = (select auth.uid()));

-- Moving a key between app, organization and universal scope is audited as
-- its own action.
alter table public.byok_audit_log drop constraint if exists byok_audit_log_action_check;
alter table public.byok_audit_log
  add constraint byok_audit_log_action_check
  check (action in ('added', 'rotated', 'removed', 'used', 'tested', 'rescoped'));

-- Is a Vault secret still referenced? A secret is NOT always owned by one
-- byok_keys row: live data has a pool row whose vault_secret_id is the same
-- secret a project's legacy `project_settings.byok_<provider>_key_ref` points
-- at, and the resolver uses that legacy ref. So a secret is in use while any
-- byok_keys row, or any `*_ref` column of project_settings or
-- organization_integration_settings, holds it, as the bare uuid or as
-- `vault://<uuid>`. The `*_ref` columns are read from information_schema on
-- every call, so a ref column added later is covered without editing this.
create or replace function private.vault_secret_in_use(p_secret_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  col record;
  hit boolean;
begin
  if p_secret_id is null then
    return false;
  end if;
  if exists (select 1 from public.byok_keys k where k.vault_secret_id = p_secret_id) then
    return true;
  end if;
  for col in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('project_settings', 'organization_integration_settings')
      and c.column_name like '%\_ref' escape '\'
      and c.data_type in ('text', 'character varying', 'uuid')
  loop
    execute format(
      'select exists (select 1 from public.%I where %I::text in ($1, $2))',
      col.table_name, col.column_name
    )
    into hit
    using p_secret_id::text, 'vault://' || p_secret_id::text;
    if hit then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function private.vault_secret_in_use(uuid) from public, anon, authenticated;

-- The pool-key DELETE route's cleanup: deletes the secret only when nothing
-- references it any more (vault_delete_secret_by_id deleted it regardless,
-- which would have removed a legacy credential's live secret). Returns the
-- number of secrets deleted (0 or 1). Service role only.
create or replace function public.vault_delete_secret_if_unused(secret_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  if secret_id is null or private.vault_secret_in_use(secret_id) then
    return 0;
  end if;
  with d as (delete from vault.secrets s where s.id = secret_id returning 1)
  select count(*) into v_count from d;
  return v_count;
end;
$$;

revoke all on function public.vault_delete_secret_if_unused(uuid) from public, anon, authenticated;
grant execute on function public.vault_delete_secret_if_unused(uuid) to service_role;

-- A key row can now disappear without the API's DELETE route: deleting the
-- owner's auth user cascades to their universal keys (as deleting a project or
-- organization cascades to its keys). Delete the row's Vault secret with it,
-- unless something else still references it (private.vault_secret_in_use).
-- The row is already gone when this AFTER trigger runs, so it does not count
-- itself. A missing Vault privilege only warns: removing the key row matters
-- more than removing its secret.
create or replace function private.byok_keys_delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.vault_secret_id is not null and not private.vault_secret_in_use(old.vault_secret_id) then
    begin
      delete from vault.secrets where id = old.vault_secret_id;
    exception when insufficient_privilege then
      raise warning 'byok_keys: could not delete Vault secret % (insufficient privilege)', old.vault_secret_id;
    end;
  end if;
  return old;
end;
$$;

revoke all on function private.byok_keys_delete_vault_secret() from public, anon, authenticated;

drop trigger if exists trg_byok_keys_delete_vault_secret on public.byok_keys;
create trigger trg_byok_keys_delete_vault_secret
  after delete on public.byok_keys
  for each row execute function private.byok_keys_delete_vault_secret();

comment on column public.byok_keys.owner_user_id is
  'Set for a universal key: it serves every project in every organization where this user has role owner (ADR 0031). project_id and organization_id are then null.';
