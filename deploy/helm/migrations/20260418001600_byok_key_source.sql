-- ============================================================
-- C9: Track which key source served each LLM invocation.
--
-- Adds llm_invocations.key_source so customers can prove their BYOK
-- credentials were actually used (billing reconciliation, SOC 2 evidence).
-- Also wires vault_get_secret as a thin alias over vault_lookup so the
-- legacy byok.ts module keeps working alongside the new storage adapter.
-- ============================================================

ALTER TABLE llm_invocations
  ADD COLUMN IF NOT EXISTS key_source TEXT
    CHECK (key_source IN ('byok', 'env'));

COMMENT ON COLUMN llm_invocations.key_source IS
  '''byok'' = customer-supplied key, ''env'' = platform default key.';

-- Convenience alias so byok.ts (which uses vault_get_secret) and storage.ts
-- (which uses vault_lookup) share a single Vault resolution path.
CREATE OR REPLACE FUNCTION vault_get_secret(secret_id TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vault_lookup(secret_id);
$$;

REVOKE ALL ON FUNCTION vault_get_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_get_secret(TEXT) TO service_role;

-- ------------------------------------------------------------
-- vault_store_secret(name, value) — UPSERT a Supabase Vault secret.
--
-- Used by the admin BYOK panel to register customer-supplied LLM keys.
-- SECURITY DEFINER so service_role Edge Functions can write to vault.secrets
-- without granting blanket write access. Name uniqueness is enforced via
-- ON CONFLICT — re-saving a key for the same project rotates it in place.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION vault_store_secret(secret_name TEXT, secret_value TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Try update first (rotation path).
  UPDATE vault.secrets
     SET secret = secret_value, updated_at = now()
   WHERE name = secret_name
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT vault.create_secret(secret_value, secret_name) INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vault_store_secret(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_store_secret(TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- vault_delete_secret(name) — REMOVE a Vault secret.
--
-- Used when an admin clears a BYOK key. Returns the number of rows deleted
-- so callers can tell whether the secret existed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION vault_delete_secret(secret_name TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH d AS (DELETE FROM vault.secrets WHERE name = secret_name RETURNING 1)
  SELECT COUNT(*) INTO v_count FROM d;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION vault_delete_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_delete_secret(TEXT) TO service_role;
