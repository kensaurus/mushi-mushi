-- Legacy BYOK removal deleted a Vault secret by name (vault_delete_secret).
-- A byok_keys row can share that secret: its vault_secret_id is the same
-- row the legacy name points at (yen-yen's Anthropic key, 2026-10-21). This
-- resolves the name, or the id when the argument is a uuid, and deletes only
-- rows private.vault_secret_in_use no longer sees. Returns how many rows
-- were deleted.
--
-- Callers clear the legacy project_settings *_ref columns first. Those
-- columns are a use, and vault_secret_in_use reads them. If this function is
-- not applied yet, the route logs and leaves the secret; it does not fall
-- back to vault_delete_secret.
--
-- Grants match public.vault_delete_secret_if_unused (service_role only).

create or replace function public.vault_delete_secret_by_name_if_unused(secret_name text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  if secret_name is null or secret_name = '' then
    return 0;
  end if;

  -- Same uuid test as vault_lookup. CASE does not cast unless the text is a uuid.
  v_id := case
    when secret_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then secret_name::uuid
    else null
  end;

  with d as (
    delete from vault.secrets s
    where (s.name = secret_name or (v_id is not null and s.id = v_id))
      and not private.vault_secret_in_use(s.id)
    returning 1
  )
  select count(*) into v_count from d;
  return v_count;
end;
$$;

revoke all on function public.vault_delete_secret_by_name_if_unused(text) from public, anon, authenticated;
grant execute on function public.vault_delete_secret_by_name_if_unused(text) to service_role;

notify pgrst, 'reload schema';
