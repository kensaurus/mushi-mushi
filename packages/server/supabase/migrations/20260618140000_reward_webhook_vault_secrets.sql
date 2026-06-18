/*
FILE: 20260618140000_reward_webhook_vault_secrets.sql
PURPOSE: Vault-back reward webhook signing secrets (Workstream D2).

CHANGES:
1. reward_webhooks.vault_secret_id — Vault reference to the raw HMAC signing
   secret. The existing `secret_hash` column keeps a SHA-256 for display /
   "does this match" checks; the raw secret now lives in Vault and is fetched
   server-side via vault_get_secret for signing deliveries.

2. Restore the canonical vault_store_secret(text, text, uuid) function. It was
   defined in 20260522100000_privacy_hardening_wave5.sql but is absent on the
   live database (verified via pg_proc) — which also breaks BYOK key saves and
   every vaulted integration write. This re-creates the exact documented body
   + grants so vault_store_secret / vault_get_secret form a working pair, which
   the reward-webhook secret rotation (API-key style "shown once") depends on.

NOTES:
- vault_store_secret is SECURITY DEFINER and granted to service_role only.
*/

alter table reward_webhooks
  add column if not exists vault_secret_id text;

comment on column reward_webhooks.vault_secret_id is
  'Vault secret id holding the raw HMAC signing secret for this webhook (Workstream D2). secret_hash retains a SHA-256 for display/equality checks only.';

-- Restore the canonical 3-arg vault_store_secret (idempotent CREATE OR REPLACE).
create or replace function vault_store_secret(
  secret_name  text,
  secret_value text,
  p_project_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_id uuid;
  expected_prefix text;
begin
  if p_project_id is not null then
    expected_prefix := 'mushi_' || p_project_id::text || '_';
    if not starts_with(secret_name, expected_prefix) then
      raise exception 'vault_store_secret: secret_name must start with % (got %)',
        expected_prefix, secret_name
        using errcode = 'check_violation';
    end if;
  end if;

  update vault.secrets
     set secret = secret_value, updated_at = now()
   where name = secret_name
   returning id into v_id;

  if v_id is null then
    select vault.create_secret(secret_value, secret_name) into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function vault_store_secret(text, text, uuid) from public;
grant execute on function vault_store_secret(text, text, uuid) to service_role;

notify pgrst, 'reload schema';
