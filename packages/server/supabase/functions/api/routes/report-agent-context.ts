/**
 * FILE: api/routes/report-agent-context.ts
 * PURPOSE: What an agent pulls about a report before it edits code, plus the
 *          repo files it keeps next to the code:
 *
 *   GET  /v1/admin/reports/:id/fix-context       paste-ready fix packet + the fields behind it
 *   GET  /v1/admin/reports/:id/blast-radius      graph nodes a change for this report can reach
 *   POST /v1/admin/projects/:id/repo/bootstrap   .cursorrules, .mushi/lessons.json, MUSHI.md
 *
 * Why (2026-09-21): the MCP `triage_issue` tool (stdio and hosted) has called
 * the first two since it shipped and `setup_repo_for_mushi` the third, and
 * none of them existed. triage_issue swallowed the 404s and returned
 * fix_context: null, blast_radius: null with a recommendation to dispatch
 * anyway; setup_repo_for_mushi failed outright.
 *
 * Auth: adminOrApiKey (mcp:read) — console JWTs and MCP keys. Report routes
 * authorize the report's own project with canAccessReportProject (org-scoped
 * keys reach every project their owner can); the bootstrap route runs the
 * same check on the project in the URL.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import { composeFixPacket, fixPacketContextFromReport, type FixPacketFile } from '../../_shared/fix-packet.ts';
import { getRelevantCode } from '../../_shared/rag.ts';
import { getBlastRadius } from '../../_shared/knowledge-graph.ts';
import { canAccessReportProject, dbError, parseUuidParam } from '../shared.ts';
import {
  buildRepoBootstrapFiles,
  inventoryAnchorOf,
  inventoryBlastRadiusNote,
  mergeAffected,
  pagePathOf,
  type AffectedNode,
  type BlastRadiusAnchor,
  type BlastRadiusAnchorKind,
  type InventoryAnchor,
  type LessonRow,
} from './report-agent-context-helpers.ts';

type Db = ReturnType<typeof getServiceClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIX_CONTEXT_COLUMNS =
  'id, project_id, status, severity, category, component, summary, confidence, stage2_analysis, reproduction_steps, bug_ontology_tags, screenshot_url';

/** Lessons shipped in .mushi/lessons.json; `mushi sync-lessons` uses the same default. */
const BOOTSTRAP_LESSON_LIMIT = 500;

function notFound(message: string) {
  return { ok: false as const, error: { code: 'NOT_FOUND', message } };
}

/**
 * The fix packet every surface shares (report detail, fix-context, CLI
 * `mushi fix`): diagnosis, repro, suggested fix, relevant code and the
 * inventory blast-radius note. RAG is best-effort — a missing codebase index
 * must not fail the caller. Never throws.
 */
export async function buildReportFixPacket(
  db: Db,
  row: Record<string, unknown>,
  anchor: InventoryAnchor | null,
): Promise<{ fixPacket: string | null; ragFiles: FixPacketFile[] }> {
  let ragFiles: FixPacketFile[] = [];
  if (typeof row.summary === 'string' && row.summary && typeof row.project_id === 'string') {
    try {
      const rag = await getRelevantCode(db, row.project_id, { symptom: row.summary });
      ragFiles = rag.slice(0, 5).map((f) => ({
        path: f.filePath,
        snippet: f.preview?.slice(0, 600) ?? '',
      }));
    } catch {
      // RAG is best-effort — a missing index must not break the caller.
    }
  }
  try {
    const fixPacket = composeFixPacket(
      fixPacketContextFromReport(row, { ragFiles, blastRadius: inventoryBlastRadiusNote(anchor) }),
    );
    return { fixPacket, ragFiles };
  } catch {
    return { fixPacket: null, ragFiles };
  }
}

async function loadInventoryAnchor(db: Db, reportId: string): Promise<InventoryAnchor | null> {
  const { data } = await db.rpc('get_report_inventory_action', { p_report_id: reportId });
  return inventoryAnchorOf(data);
}

async function findGraphNode(
  db: Db,
  projectId: string,
  nodeType: string,
  label: string,
  via: BlastRadiusAnchorKind,
): Promise<BlastRadiusAnchor | null> {
  const { data } = await db
    .from('graph_nodes')
    .select('id, node_type, label')
    .eq('project_id', projectId)
    .eq('node_type', nodeType)
    .eq('label', label)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    node_id: data.id as string,
    node_type: data.node_type as string,
    label: data.label as string,
    via,
  };
}

export function registerReportAgentContextRoutes(app: Hono<{ Variables: Variables }>): void {
  // Fix context for one report: the same packet the report detail page and
  // get_fix_context carry, without the detail route's timeline joins.
  app.get('/v1/admin/reports/:id/fix-context', adminOrApiKey(), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: report, error } = await db
      .from('reports')
      .select(FIX_CONTEXT_COLUMNS)
      .eq('id', reportId)
      .maybeSingle();
    if (error) return dbError(c, error);
    const row = report as Record<string, unknown> | null;
    if (!row || !(await canAccessReportProject(c, db, userId, row.project_id as string))) {
      return c.json(notFound('Report not found'), 404);
    }

    const anchor = await loadInventoryAnchor(db, reportId);
    const { fixPacket, ragFiles } = await buildReportFixPacket(db, row, anchor);
    const s2 = (row.stage2_analysis as Record<string, unknown> | null) ?? {};

    return c.json({
      ok: true,
      data: {
        report_id: reportId,
        project_id: row.project_id,
        status: row.status ?? null,
        severity: row.severity ?? null,
        category: row.category ?? null,
        component: row.component ?? null,
        summary: row.summary ?? null,
        fix_prompt: fixPacket,
        root_cause: s2.rootCause ?? null,
        suggested_fix: s2.suggestedFix ?? null,
        reproduction_steps: s2.reproductionSteps ?? row.reproduction_steps ?? [],
        bug_ontology_tags: row.bug_ontology_tags ?? [],
        inventory_action: anchor ? { node_id: anchor.nodeId, label: anchor.label } : null,
        relevant_files: ragFiles,
      },
    });
  });

  // Blast radius for one report. A report is a set of graph anchors (its
  // inventory action, component, page and report group); this unions their
  // precomputed radii. No anchor yet (unclassified report, empty graph) is an
  // answer, not an error: 200 with resolved:false, so a triage call never
  // reports a healthy report as a failure.
  app.get('/v1/admin/reports/:id/blast-radius', adminOrApiKey(), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: report, error } = await db
      .from('reports')
      .select('id, project_id, component, report_group_id, environment')
      .eq('id', reportId)
      .maybeSingle();
    if (error) return dbError(c, error);
    const row = report as Record<string, unknown> | null;
    if (!row || !(await canAccessReportProject(c, db, userId, row.project_id as string))) {
      return c.json(notFound('Report not found'), 404);
    }
    const projectId = row.project_id as string;

    const component = typeof row.component === 'string' && row.component.trim() ? row.component : null;
    const groupId = typeof row.report_group_id === 'string' ? row.report_group_id : null;
    const env = (row.environment as Record<string, unknown> | null) ?? {};
    const pagePath = pagePathOf(typeof env.url === 'string' ? env.url : null);

    const [inventory, componentNode, pageNode, groupNode] = await Promise.all([
      loadInventoryAnchor(db, reportId),
      component ? findGraphNode(db, projectId, 'component', component, 'component') : null,
      pagePath ? findGraphNode(db, projectId, 'page', pagePath, 'page') : null,
      groupId ? findGraphNode(db, projectId, 'report_group', groupId, 'report_group') : null,
    ]);

    const anchors: BlastRadiusAnchor[] = [];
    if (inventory) {
      anchors.push({
        node_id: inventory.nodeId,
        node_type: 'action',
        label: inventory.label ?? inventory.nodeId,
        via: 'inventory_action',
      });
    }
    for (const node of [componentNode, pageNode, groupNode]) {
      if (node && !anchors.some((a) => a.node_id === node.node_id)) anchors.push(node);
    }

    const perAnchor = await Promise.all(
      anchors.map(async (anchor) => ({
        anchor,
        affected: (await getBlastRadius(db, anchor.node_id)) as AffectedNode[],
      })),
    );
    const affected = mergeAffected(perAnchor);

    return c.json({
      ok: true,
      data: {
        report_id: reportId,
        project_id: projectId,
        resolved: anchors.length > 0,
        reason: anchors.length === 0 ? 'no_graph_node' : affected.length === 0 ? 'no_downstream_nodes' : null,
        anchors,
        affected,
      },
    });
  });

  // Repo bootstrap files for setup_repo_for_mushi. The server cannot write
  // into the caller's checkout; it returns the files and the agent writes
  // them at the repository root. Read-only here, so mcp:read suffices; the
  // MCP tool itself is gated on mcp:write because it writes to disk.
  app.post('/v1/admin/projects/:id/repo/bootstrap', adminOrApiKey(), async (c) => {
    const projectId = c.req.param('id') ?? '';
    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!(await canAccessReportProject(c, db, userId, projectId))) {
      return c.json(notFound('Project not found'), 404);
    }
    const [projectRes, lessonsRes] = await Promise.all([
      db.from('projects').select('id, name').eq('id', projectId).maybeSingle(),
      db
        .from('lessons')
        .select('id, rule_text, anti_pattern, severity, frequency, last_reinforced_at, cluster_id')
        .eq('project_id', projectId)
        .is('retired_at', null)
        .order('frequency', { ascending: false })
        .order('last_reinforced_at', { ascending: false })
        .limit(BOOTSTRAP_LESSON_LIMIT),
    ]);
    if (projectRes.error) return dbError(c, projectRes.error);
    if (!projectRes.data) return c.json(notFound('Project not found'), 404);
    if (lessonsRes.error) return dbError(c, lessonsRes.error);

    const lessons = (lessonsRes.data ?? []) as LessonRow[];
    const files = buildRepoBootstrapFiles({
      projectId,
      projectName: (projectRes.data.name as string | null) ?? 'This project',
      lessons,
      generatedAt: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      data: {
        project_id: projectId,
        lesson_count: lessons.length,
        files,
        instructions:
          'Write each file at its path relative to the repository root, replacing any earlier Mushi copy. ' +
          'Keep .mushi/lessons.json current with `npx @mushi-mushi/cli sync-lessons` in CI.',
      },
    });
  });
}
