-- FILE: 20260511120000_get_report_inventory_action.sql
--
-- Returns the inventory action node linked to a given report, by walking
-- the knowledge graph and falling back to the fix dispatch FK.
--
-- Two resolution paths (highest-fidelity first):
--   1. graph_nodes(node_type='report_group', label=reportId)
--        → graph_edges(edge_type='reports_against')
--        → graph_nodes(node_type='action')           ← what we return
--      (populated by classify-report → linkReportToAction)
--   2. fix_dispatch_jobs.inventory_action_node_id
--      (populated by fix-worker dispatch upstream — covers reports that
--       were dispatched but never classified via Stage 2)
--
-- Used by /v1/admin/reports/:id to populate the FixCard "Origin" drawer
-- and the MCP `get_fix_context.inventoryAction` field.

CREATE OR REPLACE FUNCTION public.get_report_inventory_action(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_node_id uuid;
  v_action_node_id uuid;
  v_node           jsonb;
BEGIN
  -- Path 1: report_group node → reports_against edge → action node
  SELECT gn.id
  INTO   v_report_node_id
  FROM   graph_nodes gn
  WHERE  gn.node_type = 'report_group'
    AND  gn.label     = p_report_id::text
  LIMIT  1;

  IF v_report_node_id IS NOT NULL THEN
    SELECT ge.target_node_id
    INTO   v_action_node_id
    FROM   graph_edges ge
    JOIN   graph_nodes gn ON gn.id = ge.target_node_id
    WHERE  ge.source_node_id = v_report_node_id
      AND  ge.edge_type      = 'reports_against'
      AND  gn.node_type      = 'action'
    ORDER  BY ge.created_at DESC
    LIMIT  1;
  END IF;

  -- Path 2: fix_dispatch_jobs FK fallback
  IF v_action_node_id IS NULL THEN
    SELECT j.inventory_action_node_id
    INTO   v_action_node_id
    FROM   fix_dispatch_jobs j
    WHERE  j.report_id = p_report_id
      AND  j.inventory_action_node_id IS NOT NULL
    ORDER  BY j.created_at DESC
    LIMIT  1;
  END IF;

  IF v_action_node_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'actionNodeId',      gn.id,
    'actionLabel',       gn.label,
    'actionDescription', gn.metadata->>'action',
    'pagePath',          gn.metadata->>'page_path',
    'pageId',            gn.metadata->>'page_id',
    'storyTitle',        gn.metadata->>'story_title',
    'storyId',           gn.metadata->>'story_id',
    'expectedOutcome',   gn.metadata->'expected_outcome',
    'status',            gn.metadata->>'status',
    'nodeType',          gn.node_type,
    'projectId',         gn.project_id
  )
  INTO v_node
  FROM graph_nodes gn
  WHERE gn.id = v_action_node_id;

  RETURN v_node;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_report_inventory_action(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_report_inventory_action(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_report_inventory_action(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_report_inventory_action(uuid) TO service_role;

COMMENT ON FUNCTION public.get_report_inventory_action(uuid) IS
  'Returns the inventory action node (with expected_outcome contract) linked to a report via graph_edges or fix_dispatch_jobs. Used by /v1/admin/reports/:id.';
