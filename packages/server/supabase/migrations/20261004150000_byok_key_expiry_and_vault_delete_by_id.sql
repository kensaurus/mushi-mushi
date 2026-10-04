/*
PURPOSE: Two small, additive fixes for Settings → Your AI keys.

1. byok_keys.expires_at (nullable). Supabase access tokens, and many other
   provider keys, are created with an expiry date that no provider API lets
   Mushi read back. The owner can now type the date when adding a key, and the
   console warns 7 days before it lapses. NULL means "no known expiry".

2. vault_delete_secret_by_id(uuid). Pool keys keep the Vault secret's id
   (byok_keys.vault_secret_id), not its name, but the only delete helper,
   vault_delete_secret(text), matches by name. The pool-key DELETE route
   passed `secret_id` to it, PostgREST found no such signature, and every
   removed pool key left its secret behind in Vault.

DEPLOY ORDER: safe in either order. The api function reads expires_at in a
separate, failure-tolerant query and treats a missing RPC as a non-fatal
cleanup warning, so deploying code first only delays the fixes.
*/

alter table public.byok_keys
  add column if not exists expires_at timestamptz;

comment on column public.byok_keys.expires_at is
  'When the provider credential stops working, as entered by the owner. NULL = unknown or never.';

create or replace function public.vault_delete_secret_by_id(secret_id uuid)
returns int
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_count int;
begin
  with d as (delete from vault.secrets where id = secret_id returning 1)
  select count(*) into v_count from d;
  return v_count;
end;
$$;

-- Service role only. Revoke from anon/authenticated explicitly: default
-- privileges re-grant EXECUTE on new public functions.
revoke all on function public.vault_delete_secret_by_id(uuid) from public, anon, authenticated;
grant execute on function public.vault_delete_secret_by_id(uuid) to service_role;

notify pgrst, 'reload schema';
