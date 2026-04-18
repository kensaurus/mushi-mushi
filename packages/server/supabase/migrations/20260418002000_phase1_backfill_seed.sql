-- Migration: 20260418002000_phase1_backfill_seed
-- Purpose:   Phase 1 of the admin-console-tab-overhaul plan.
--            1. Purge bogus "component" graph nodes whose labels are bug categories
--               (the result of fast-filter passing `classification.category`
--               into buildReportGraph as the component name).
--            2. Backfill component nodes from `reports.component` so the graph
--               page renders something real.
--            3. Seed two starter prompt_versions per stage so the Prompt Lab
--               page has rows on first paint.
-- Safe to run on databases that have no offending data: all statements are
-- idempotent / scoped by row predicates.

-- 1. Purge category-shaped component nodes (and their edges) -----------------
WITH bogus AS (
  SELECT id
    FROM graph_nodes
   WHERE node_type = 'component'
     AND label IN ('bug', 'slow', 'visual', 'confusing', 'other')
)
DELETE FROM graph_edges
 WHERE source_node_id IN (SELECT id FROM bogus)
    OR target_node_id IN (SELECT id FROM bogus);

DELETE FROM graph_nodes
 WHERE node_type = 'component'
   AND label IN ('bug', 'slow', 'visual', 'confusing', 'other');

-- 2. Backfill component nodes from reports.component -------------------------
INSERT INTO graph_nodes (project_id, node_type, label, metadata)
SELECT DISTINCT
       r.project_id,
       'component'::text,
       r.component,
       jsonb_build_object('source', 'phase1_backfill')
  FROM reports r
 WHERE r.component IS NOT NULL
   AND length(trim(r.component)) > 0
   AND NOT EXISTS (
     SELECT 1 FROM graph_nodes g
      WHERE g.project_id = r.project_id
        AND g.node_type  = 'component'
        AND g.label      = r.component
   );

-- 3. Wire affects edges (group -> component) where both nodes exist ----------
INSERT INTO graph_edges (project_id, source_node_id, target_node_id, edge_type, weight)
SELECT DISTINCT
       r.project_id,
       grp.id,
       comp.id,
       'affects'::text,
       1
  FROM reports r
  JOIN graph_nodes comp ON comp.project_id = r.project_id
                       AND comp.node_type  = 'component'
                       AND comp.label      = r.component
  JOIN graph_nodes grp  ON grp.project_id  = r.project_id
                       AND grp.node_type   = 'report_group'
                       AND grp.label       = r.report_group_id::text
 WHERE r.component IS NOT NULL
   AND r.report_group_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM graph_edges e
      WHERE e.source_node_id = grp.id
        AND e.target_node_id = comp.id
        AND e.edge_type       = 'affects'
   );

-- 4. Seed starter prompt_versions --------------------------------------------
-- Seeds the global default rows so the Prompt Lab leaderboard isn't empty for
-- a fresh install. We deliberately use NULL project_id (the "global" namespace
-- per uq_prompt_versions_scope) and very short placeholder templates that the
-- code already knows how to override per-project.
INSERT INTO prompt_versions
  (project_id, stage, version, prompt_template, is_active, is_candidate,
   traffic_percentage, avg_judge_score, total_evaluations)
SELECT NULL, stage, version, template, is_active, is_candidate,
       traffic_percentage, NULL::float, 0
  FROM (VALUES
    ('stage1', 'v1-baseline',  'You triage user-submitted bug reports. Output {category, severity, symptom, action, actual, confidence}.', true,  false, 100),
    ('stage1', 'v2-experiment','You triage bug reports. Be concise. Prefer "slow" over "bug" when latency >2s. Output {category, severity, symptom, action, actual, confidence}.', false, true,  0),
    ('stage2', 'v1-baseline',  'You are a senior engineer doing root-cause analysis. Output {category, severity, summary, component, rootCause, reproductionSteps, suggestedFix, confidence}.', true,  false, 100),
    ('stage2', 'v2-experiment','You are a senior engineer doing root-cause analysis. Cite file:line when you can. Output the standard schema.', false, true,  0)
  ) AS seed(stage, version, template, is_active, is_candidate, traffic_percentage)
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions p
   WHERE p.project_id IS NULL
     AND p.stage   = seed.stage
     AND p.version = seed.version
);
