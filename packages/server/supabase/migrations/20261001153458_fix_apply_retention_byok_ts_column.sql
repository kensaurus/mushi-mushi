-- byok_audit_log's timestamp column is `ts`, not `created_at`; the old dynamic
-- DELETE would raise as soon as any project_retention_policies row existed.
CREATE OR REPLACE FUNCTION public.mushi_apply_retention()
 RETURNS TABLE(project_id uuid, table_name text, deleted_rows bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  policy RECORD;
  cutoff TIMESTAMPTZ;
  removed BIGINT;
BEGIN
  FOR policy IN
    SELECT prp.*, p.id AS pid
    FROM project_retention_policies prp
    JOIN projects p ON p.id = prp.project_id
    WHERE prp.legal_hold = FALSE
  LOOP
    cutoff := now() - make_interval(days => policy.reports_retention_days);
    DELETE FROM reports WHERE reports.project_id = policy.pid AND created_at < cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    project_id := policy.pid; table_name := 'reports'; deleted_rows := removed; RETURN NEXT;

    cutoff := now() - make_interval(days => policy.audit_retention_days);
    DELETE FROM audit_logs WHERE audit_logs.project_id = policy.pid AND created_at < cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    project_id := policy.pid; table_name := 'audit_logs'; deleted_rows := removed; RETURN NEXT;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE information_schema.tables.table_name = 'byok_audit_log') THEN
      cutoff := now() - make_interval(days => policy.byok_audit_retention_days);
      EXECUTE format(
        'DELETE FROM byok_audit_log WHERE project_id = $1 AND ts < $2'
      ) USING policy.pid, cutoff;
      GET DIAGNOSTICS removed = ROW_COUNT;
      project_id := policy.pid; table_name := 'byok_audit_log'; deleted_rows := removed; RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;
