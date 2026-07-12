/*
FILE: 20260621110000_fix_vault_store_secret_update.sql
PURPOSE: Fix vault_store_secret to use Supabase Vault API instead of direct table writes.

OVERVIEW:
- vault_store_secret used direct UPDATE vault.secrets which fails with
  "permission denied for table secrets" even for the function definer.
- The correct approach is to use vault.update_secret() for rotation
  (which owns the write privilege) and vault.create_secret() for new entries.
- vault.secrets is read-accessible (SELECT is fine) but direct writes require
  the vault-owned functions.

NOTES:
- Fixes the identity-secret API's VAULT_ERROR response.
- Also fixes any other caller that rotates BYOK keys.
*/

CREATE OR REPLACE FUNCTION vault_store_secret(
  secret_name  TEXT,
  secret_value TEXT,
  p_project_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_id   UUID;
  v_prefix TEXT;
BEGIN
  IF p_project_id IS NOT NULL THEN
    v_prefix := 'mushi_' || p_project_id::TEXT || '_';
    IF NOT starts_with(secret_name, v_prefix) THEN
      RAISE EXCEPTION 'vault_store_secret: secret_name must start with % (got %)',
        v_prefix, secret_name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Read-only lookup to check if the named secret already exists.
  SELECT id INTO v_id
  FROM vault.secrets
  WHERE name = secret_name
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Rotation path: use vault.update_secret() (owns the write privilege).
    PERFORM vault.update_secret(v_id, secret_value);
  ELSE
    -- New secret: vault.create_secret() owns INSERT privilege.
    SELECT vault.create_secret(secret_value, secret_name) INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vault_store_secret(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vault_store_secret(TEXT, TEXT, UUID) TO service_role;
