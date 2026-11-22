-- Legacy single-key removal (BL-098).
--
-- DELETE /v1/admin/byok/:provider, the Firecrawl and Browserbase deletes, and
-- retiring a legacy key after its pooled copy validates used to call
-- vault_delete_secret by name. That deletes the row by name even when a
-- byok_keys.vault_secret_id is the same secret (yen-yen's Anthropic key,
-- 2026-10-21), so the pooled key's next read fails.
--
-- Resolve the name, or the uuid when the stored ref is vault://<uuid>, then
-- call vault_delete_secret_if_unused (private.vault_secret_in_use). Callers
-- clear their own project_settings ref first: a leftover vault://<uuid> ref
-- counts as still in use and would keep every legacy secret. A missing
-- function must not fall back to the unchecked delete; the secret stays in
-- Vault until this migration is applied.
--
-- DEPLOY ORDER: apply this migration first, then deploy the api function.
-- Code deployed first leaves the secret in Vault (the route does not fall
-- back) and still clears the legacy columns.

create or replace function public.vault_delete_secret_by_name_if_unused(secret_name text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if secret_name is null or btrim(secret_name) = '' then
    return 0;
  end if;

  select s.id into v_id
  from vault.secrets s
  where s.name = secret_name
  limit 1;

  if v_id is null and secret_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select s.id into v_id
    from vault.secrets s
    where s.id = secret_name::uuid
    limit 1;
  end if;

  if v_id is null then
    return 0;
  end if;

  return public.vault_delete_secret_if_unused(v_id);
end;
$$;

revoke all on function public.vault_delete_secret_by_name_if_unused(text) from public, anon, authenticated;
grant execute on function public.vault_delete_secret_by_name_if_unused(text) to service_role;

notify pgrst, 'reload schema';
