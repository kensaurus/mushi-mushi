-- count_by_column: fast GROUP-BY helper used by /v1/admin/stats.
-- Returns one row per distinct non-null value with its count.
-- Takes any column name and an array of project IDs to scope the query.
CREATE OR REPLACE FUNCTION count_by_column(
  col TEXT,
  project_ids UUID[]
) RETURNS TABLE(val TEXT, cnt BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate col to prevent SQL injection — only allow known report columns.
  IF col NOT IN ('status', 'category', 'severity', 'platform', 'component') THEN
    RAISE EXCEPTION 'count_by_column: unsupported column %', col;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT %I::text AS val, COUNT(*)::bigint AS cnt
     FROM reports
     WHERE project_id = ANY($1)
       AND %I IS NOT NULL
     GROUP BY %I
     ORDER BY cnt DESC',
    col, col, col
  ) USING project_ids;
END;
$$;

-- Grant execute to the service role the edge function uses.
GRANT EXECUTE ON FUNCTION count_by_column(TEXT, UUID[]) TO service_role;
