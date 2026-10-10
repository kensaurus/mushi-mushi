-- ============================================================================
-- 20261010130000_vault_lookup_by_id
--
-- byok_keys.vault_secret_id (and the other *_vault_secret_id / vault://<id>
-- refs) store the UUID that vault_store_secret returns, and _shared/byok.ts
-- passes it to vault_get_secret -> vault_lookup. The repo's vault_lookup
-- (20260418001500_byo_storage) matched `name` only, so a database built from
-- these migrations (self-host, Helm) could never dereference those refs.
--
-- The hosted project already had the by-id fallback, applied outside the
-- migration history. This brings the repo in line with that live body:
-- match by name first, then by id when the input is a UUID. CREATE OR
-- REPLACE keeps the existing grants; they are restated to match live
-- (service_role only).
-- ============================================================================

create or replace function public.vault_lookup(secret_name text)
returns text
language plpgsql
security definer
set search_path = vault, public
as $fn$
declare
  v text;
begin
  select decrypted_secret into v
  from vault.decrypted_secrets
  where name = secret_name
  limit 1;

  if v is null and secret_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select decrypted_secret into v
    from vault.decrypted_secrets
    where id = secret_name::uuid
    limit 1;
  end if;

  return v;
exception when others then
  return null;
end;
$fn$;

revoke all on function public.vault_lookup(text) from public, anon, authenticated;
grant execute on function public.vault_lookup(text) to service_role;
