-- Expose a read-only execute_sql RPC for edge functions to introspect the schema.
-- Used by contract-graph-builder to build pg_schema snapshots for drift detection.
-- Security: callable by service_role only (bypasses RLS); uses SECURITY DEFINER
-- so the call runs with the function owner's privileges. Restricted to SELECT
-- statements to prevent accidental DDL/DML.

CREATE OR REPLACE FUNCTION execute_sql(sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Only allow SELECT statements to prevent DDL/DML misuse.
  IF NOT (TRIM(UPPER(sql)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'execute_sql: only SELECT statements are allowed';
  END IF;
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || sql || ') t' INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Only service_role should be able to call this function.
REVOKE EXECUTE ON FUNCTION execute_sql(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION execute_sql(text) FROM anon;
REVOKE EXECUTE ON FUNCTION execute_sql(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION execute_sql(text) TO service_role;
