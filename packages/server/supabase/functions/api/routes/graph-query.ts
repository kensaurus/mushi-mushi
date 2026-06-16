import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { getBlastRadius } from '../../_shared/knowledge-graph.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery, sanitizeSql } from '../../_shared/nl-query.ts';
import { callerProjectIds, resolveOwnedProject } from '../shared.ts';

export function registerGraphQueryRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // PHASE 2: KNOWLEDGE GRAPH
  // ============================================================

  app.get('/v1/admin/graph/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      hasIngest: false,
      nodeCount: 0,
      edgeCount: 0,
      reportNodes: 0,
      inventoryNodes: 0,
      fragileComponents: 0,
      regressionEdges: 0,
      duplicateEdges: 0,
      fixVerifiedEdges: 0,
      lastNodeAt: null as string | null,
      graphBackend: 'sql_only' as string,
      ageAvailable: false,
      unsyncedNodes: 0,
      unsyncedEdges: 0,
      topPriority: 'waiting_ingest' as
        | 'waiting_ingest'
        | 'empty'
        | 'fragile'
        | 'regressions'
        | 'clear',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const activeProject = resolvedProject.project;
    const pid = activeProject.id;

    const INVENTORY_NODE_TYPES = [
      'app',
      'page_v2',
      'element',
      'action',
      'api_dep',
      'db_dep',
      'test',
      'user_story',
    ];

    const [
      reportCountRes,
      nodesRes,
      edgesRes,
      settingsRes,
      ageAvailRes,
      unsyncedNodesRes,
      unsyncedEdgesRes,
      latestNodeRes,
    ] = await Promise.all([
      db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      db
        .from('graph_nodes')
        .select('id, node_type, created_at')
        .eq('project_id', pid)
        .limit(500),
      db
        .from('graph_edges')
        .select('id, edge_type, source_node_id, target_node_id')
        .eq('project_id', pid)
        .limit(1000),
      db.from('project_settings').select('graph_backend').eq('project_id', pid).maybeSingle(),
      db.rpc('mushi_age_available'),
      db
        .from('graph_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('age_synced_at', null),
      db
        .from('graph_edges')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('age_synced_at', null),
      db
        .from('graph_nodes')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const nodes = nodesRes.data ?? [];
    const edges = edgesRes.data ?? [];
    const nodeCount = nodes.length;
    const edgeCount = edges.length;
    const hasIngest = (reportCountRes.count ?? 0) > 0;
    const reportNodes = nodes.filter((n) => n.node_type === 'report_group').length;
    const inventoryNodes = nodes.filter((n) => INVENTORY_NODE_TYPES.includes(String(n.node_type))).length;

    const componentIds = new Set(
      nodes.filter((n) => n.node_type === 'component').map((n) => n.id),
    );
    const incomingAffects = new Map<string, number>();
    let regressionEdges = 0;
    let duplicateEdges = 0;
    let fixVerifiedEdges = 0;
    for (const e of edges) {
      const et = String(e.edge_type ?? '');
      if (et === 'regression_of') regressionEdges += 1;
      else if (et === 'duplicate_of') duplicateEdges += 1;
      else if (et === 'fix_verified') fixVerifiedEdges += 1;
      else if (et === 'affects' && componentIds.has(String(e.target_node_id))) {
        incomingAffects.set(
          String(e.target_node_id),
          (incomingAffects.get(String(e.target_node_id)) ?? 0) + 1,
        );
      }
    }
    let fragileComponents = 0;
    for (const count of incomingAffects.values()) {
      if (count >= 3) fragileComponents += 1;
    }

    let topPriority: typeof empty.topPriority = 'waiting_ingest';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (!hasIngest) {
      topPriority = 'waiting_ingest';
      topPriorityLabel = 'No reports ingested — graph seeds from classified bug reports';
      topPriorityTo = '/onboarding?tab=verify';
    } else if (nodeCount === 0) {
      topPriority = 'empty';
      topPriorityLabel = 'Reports ingested but graph empty — classifier may still be indexing';
      topPriorityTo = '/reports?tab=queue';
    } else if (fragileComponents > 0) {
      topPriority = 'fragile';
      topPriorityLabel = `${fragileComponents} fragile component${fragileComponents === 1 ? '' : 's'} (≥3 incoming affects edges)`;
      topPriorityTo = '/graph?view=fragile';
    } else if (regressionEdges > 0) {
      topPriority = 'regressions';
      topPriorityLabel = `${regressionEdges} regression edge${regressionEdges === 1 ? '' : 's'} — bugs that came back after a fix`;
      topPriorityTo = '/graph?view=regressions';
    } else {
      topPriority = 'clear';
      topPriorityLabel = `${nodeCount} nodes · ${edgeCount} edges — map is current`;
      topPriorityTo = '/graph';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name,
        projectCount: projectIds.length,
        hasIngest,
        nodeCount,
        edgeCount,
        reportNodes,
        inventoryNodes,
        fragileComponents,
        regressionEdges,
        duplicateEdges,
        fixVerifiedEdges,
        lastNodeAt: latestNodeRes.data?.created_at ?? null,
        graphBackend: settingsRes.data?.graph_backend ?? 'sql_only',
        ageAvailable: ageAvailRes.data === true,
        unsyncedNodes: unsyncedNodesRes.count ?? 0,
        unsyncedEdges: unsyncedEdgesRes.count ?? 0,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  app.get('/v1/admin/graph/nodes', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { nodes: [] } });

    const nodeType = c.req.query('type');
    let query = db
      .from('graph_nodes')
      .select('id, project_id, node_type, label, metadata, last_traversed_at, created_at')
      .in('project_id', projectIds)
      .limit(200);
    if (nodeType) query = query.eq('node_type', nodeType);

    const { data: nodes } = await query.order('created_at', { ascending: false });
    if (!nodes || nodes.length === 0) return c.json({ ok: true, data: { nodes: [] } });

    // Compute occurrence_count for component / page nodes by joining against
    // reports. Done in JS to avoid an N+1 — single SELECT, in-memory bucketing.
    // The graph page uses this to size and rank nodes.
    const componentLabels = nodes.filter((n) => n.node_type === 'component').map((n) => n.label);
    const pageLabels = nodes.filter((n) => n.node_type === 'page').map((n) => n.label);

    const counts = new Map<string, number>();
    if (componentLabels.length > 0 || pageLabels.length > 0) {
      const { data: reportRows } = await db
        .from('reports')
        .select('component, url, project_id')
        .in('project_id', projectIds);
      for (const r of reportRows ?? []) {
        if (r.component)
          counts.set(`component:${r.component}`, (counts.get(`component:${r.component}`) ?? 0) + 1);
        if (r.url) {
          try {
            const path = new URL(r.url).pathname;
            counts.set(`page:${path}`, (counts.get(`page:${path}`) ?? 0) + 1);
          } catch {
            // url may be relative; just use it as-is
            counts.set(`page:${r.url}`, (counts.get(`page:${r.url}`) ?? 0) + 1);
          }
        }
      }
    }

    const enriched = nodes.map((n) => {
      const occ = counts.get(`${n.node_type}:${n.label}`) ?? 0;
      const meta =
        n.metadata && typeof n.metadata === 'object' && !Array.isArray(n.metadata)
          ? { ...(n.metadata as Record<string, unknown>), occurrence_count: occ }
          : { occurrence_count: occ };
      return { ...n, metadata: meta };
    });

    return c.json({ ok: true, data: { nodes: enriched } });
  });

  app.get('/v1/admin/graph/edges', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    const edgeType = c.req.query('type');
    let query = db
      .from('graph_edges')
      .select('id, project_id, source_node_id, target_node_id, edge_type, weight, created_at')
      .in('project_id', projectIds)
      .limit(500);
    if (edgeType) query = query.eq('edge_type', edgeType);

    const { data } = await query;
    return c.json({ ok: true, data: { edges: data ?? [] } });
  });

  /**
   * Wave G2 — graph traversal for the MCP `get_knowledge_graph` tool and any
   * caller that wants more than blast-radius. Returns nodes + edges within a
   * BFS depth budget, starting from a node id OR a label match. Capped at
   * depth=4 and 500 nodes so an LLM can't blow up the response budget.
   */
  app.get('/v1/admin/graph/traverse', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const seed = (c.req.query('seed') ?? '').trim();
    const depth = Math.max(1, Math.min(Number(c.req.query('depth') ?? 2), 4));
    if (!seed)
      return c.json(
        { ok: false, error: { code: 'MISSING_SEED', message: 'seed is required' } },
        400,
      );

    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (!projectIds.length) return c.json({ ok: true, data: { nodes: [], edges: [] } });

    const { data: seedNode } = await db
      .from('graph_nodes')
      .select('id, node_type, label, project_id')
      .in('project_id', projectIds)
      .or(`id.eq.${seed.replace(/[^a-f0-9-]/gi, '')},label.ilike.${seed.replace(/[%,]/g, '')}`)
      .limit(1)
      .maybeSingle();
    if (!seedNode) return c.json({ ok: false, error: { code: 'SEED_NOT_FOUND' } }, 404);

    const visitedNodes = new Map<string, { id: string; node_type: string; label: string }>();
    visitedNodes.set(seedNode.id, {
      id: seedNode.id,
      node_type: seedNode.node_type,
      label: seedNode.label,
    });
    const edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string }> = [];
    let frontier = [seedNode.id];

    for (let d = 0; d < depth && frontier.length && visitedNodes.size < 500; d++) {
      const { data: nextEdges } = await db
        .from('graph_edges')
        .select('source_node_id, target_node_id, edge_type')
        .in('project_id', projectIds)
        .or(`source_node_id.in.(${frontier.join(',')}),target_node_id.in.(${frontier.join(',')})`)
        .limit(500);

      const nextIds = new Set<string>();
      for (const e of nextEdges ?? []) {
        edges.push(e);
        if (!visitedNodes.has(e.source_node_id)) nextIds.add(e.source_node_id);
        if (!visitedNodes.has(e.target_node_id)) nextIds.add(e.target_node_id);
      }
      if (nextIds.size === 0) break;

      const { data: newNodes } = await db
        .from('graph_nodes')
        .select('id, node_type, label')
        .in('id', Array.from(nextIds).slice(0, 500 - visitedNodes.size));
      for (const n of newNodes ?? []) visitedNodes.set(n.id, n);
      frontier = newNodes?.map((n) => n.id) ?? [];
    }

    return c.json({ ok: true, data: { nodes: Array.from(visitedNodes.values()), edges } });
  });

  /**
   * Single graph node (metadata includes v2 inventory `status` on Action nodes).
   * Used by MCP `graph_node_status` and agents that need one row without listing 200.
   */
  app.get('/v1/admin/graph/node/:nodeId', adminOrApiKey(), async (c) => {
    const nodeId = c.req.param('nodeId')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    const { data: node, error } = await db
      .from('graph_nodes')
      .select('id, project_id, node_type, label, metadata, last_traversed_at, created_at')
      .eq('id', nodeId)
      .in('project_id', projectIds)
      .maybeSingle();
    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
    if (!node)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Node not found' } }, 404);
    return c.json({ ok: true, data: { node } });
  });

  app.get('/v1/admin/graph/blast-radius/:nodeId', adminOrApiKey(), async (c) => {
    const nodeId = c.req.param('nodeId')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    const { data: node } = await db
      .from('graph_nodes')
      .select('id')
      .eq('id', nodeId)
      .in('project_id', projectIds)
      .single();
    if (!node)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Node not found' } }, 404);
    const affected = await getBlastRadius(db, nodeId);
    return c.json({ ok: true, data: { affected } });
  });

  // ============================================================
  // PHASE 2: BUG ONTOLOGY
  // ============================================================

  app.get('/v1/admin/ontology', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    // Teams v1: any accessible project anchors the ontology read.
    const accessibleIds = await callerProjectIds(c, db, userId);
    if (accessibleIds.length === 0) return c.json({ ok: true, data: { tags: [] } });
    const project = { id: accessibleIds[0] };

    const tags = await getAvailableTags(db, project.id);
    return c.json({ ok: true, data: { tags } });
  });

  app.post('/v1/admin/ontology', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    // Teams v1: any accessible project anchors the ontology write.
    const accessibleIds = await callerProjectIds(c, db, userId);
    const project = accessibleIds.length ? { id: accessibleIds[0] } : null;
    if (!project)
      return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found' } }, 404);

    const { error } = await db.from('bug_ontology').insert({
      project_id: project.id,
      tag: body.tag,
      parent_tag: body.parentTag ?? null,
      description: body.description ?? null,
    });

    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    return c.json({ ok: true });
  });

  // ============================================================
  // PHASE 2: NATURAL LANGUAGE QUERY
  // ============================================================

  app.post('/v1/admin/query', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const { question } = await c.req.json();
    if (!question)
      return c.json(
        { ok: false, error: { code: 'MISSING_QUESTION', message: 'question is required' } },
        400,
      );

    const db = getServiceClient();

    // SEC (Wave S1 / S-3): per-user hourly rate limit. The NL endpoint fans
    // out to an LLM, a SECURITY DEFINER SQL RPC, and a summariser LLM —
    // easily the most expensive path in the API. An atomic UPSERT inside
    // nl_query_rate_limit_claim either increments the counter or raises
    // `rate_limit_exceeded` (P0001). We surface a 429 so SDKs back off.
    const { error: rateErr } = await db.rpc('nl_query_rate_limit_claim', {
      p_user_id: userId,
      p_max_per_hour: 60,
    });
    if (rateErr) {
      const msg = rateErr.message ?? '';
      if (msg.includes('rate_limit_exceeded')) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message:
                'NL-query rate limit reached (60 queries/hour). Try again next hour or contact support for a higher cap.',
            },
          },
          429,
        );
      }
      // Unknown RPC failure — fall through rather than block the user; log.
      log.warn('rate limit RPC failed', { scope: 'nl-query', err: msg });
    }

    const projectIds = await callerProjectIds(c, db, userId);
    if (!projectIds.length)
      return c.json({ ok: true, data: { results: [], summary: 'No projects found.' } });

    const startedAt = Date.now();
    try {
      const result = await executeNaturalLanguageQuery(db, projectIds, question);
      const latencyMs = Date.now() - startedAt;
      // Persist on success — best-effort; if the insert fails we still return
      // the answer so the user isn't blocked on telemetry.
      db.from('nl_query_history')
        .insert({
          project_id: projectIds[0] ?? null,
          user_id: userId,
          prompt: question,
          sql: result.sql,
          summary: result.summary,
          explanation: result.explanation,
          row_count: Array.isArray(result.results) ? result.results.length : 0,
          latency_ms: latencyMs,
        })
        .then(({ error }) => {
          if (error) log.warn('nl_query_history insert failed', { err: error.message });
        });

      return c.json({ ok: true, data: { ...result, latencyMs } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latencyMs = Date.now() - startedAt;
      db.from('nl_query_history')
        .insert({
          project_id: projectIds[0] ?? null,
          user_id: userId,
          prompt: question,
          error: message,
          latency_ms: latencyMs,
        })
        .then(({ error }) => {
          if (error) log.warn('nl_query_history insert failed', { err: error.message });
        });
      return c.json({ ok: false, error: { code: 'QUERY_ERROR', message } }, 400);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Raw SQL query — authenticated admin sends explicit SQL instead of a
  // natural-language question. Skips the LLM plan + summary steps (no AI
  // cost); everything else is identical to the NL path: same rate limit,
  // same sanitization pipeline (DANGEROUS_PATTERNS + FORBIDDEN_SCHEMAS +
  // SELECT/WITH gate + $1 scoping + comment stripping), same Postgres RPC,
  // same audit trail. Extra guards specific to raw SQL mode:
  //   - Table allowlist: only approved analytics tables (no nl_query_history,
  //     audit_logs, byok_audit_log, etc.)
  //   - LIMIT auto-append: if the user forgets LIMIT, append LIMIT 100
  //   - Input length cap: max 4 000 chars
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/v1/admin/query/raw', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as { sql?: string };
    const rawSql = body.sql?.trim() ?? '';
    if (!rawSql) {
      return c.json(
        { ok: false, error: { code: 'MISSING_SQL', message: 'sql is required' } },
        400,
      );
    }

    const db = getServiceClient();

    // Reuse the same per-user hourly rate limit as the NL endpoint. Raw SQL
    // is cheaper (no LLM) but still hits the Postgres RPC and could be abused
    // for data exfiltration if unlimited.
    const { error: rateErr } = await db.rpc('nl_query_rate_limit_claim', {
      p_user_id: userId,
      p_max_per_hour: 60,
    });
    if (rateErr) {
      const msg = rateErr.message ?? '';
      if (msg.includes('rate_limit_exceeded')) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Query rate limit reached (60 queries/hour). Try again next hour.',
            },
          },
          429,
        );
      }
      log.warn('rate limit RPC failed', { scope: 'raw-query', err: msg });
    }

    const projectIds = await callerProjectIds(c, db, userId);
    if (!projectIds.length) {
      return c.json({ ok: true, data: { sql: rawSql, results: [], rowCount: 0 } });
    }

    let cleanedSql: string;
    try {
      cleanedSql = sanitizeSql(rawSql, { tableAllowlist: true, requireProjectIdParam: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { code: 'INVALID_SQL', message } }, 400);
    }

    const startedAt = Date.now();
    const results: unknown[] = [];
    for (const projectId of projectIds) {
      const { data, error } = await db.rpc('execute_readonly_query', {
        query_text: cleanedSql,
        project_id_param: projectId,
      });
      if (error) {
        const message = `Query execution failed: ${error.message}`;
        const latencyMs = Date.now() - startedAt;
        db.from('nl_query_history')
          .insert({
            project_id: projectIds[0] ?? null,
            user_id: userId,
            prompt: rawSql,
            sql: cleanedSql,
            error: message,
            latency_ms: latencyMs,
            mode: 'raw',
          })
          .then(({ error: e }) => {
            if (e) log.warn('raw_query_history insert failed', { err: e.message });
          });
        return c.json({ ok: false, error: { code: 'QUERY_ERROR', message } }, 400);
      }
      if (data) results.push(...(Array.isArray(data) ? data : [data]));
      if (results.length >= 100) break;
    }

    const latencyMs = Date.now() - startedAt;
    db.from('nl_query_history')
      .insert({
        project_id: projectIds[0] ?? null,
        user_id: userId,
        prompt: rawSql,
        sql: cleanedSql,
        row_count: results.length,
        latency_ms: latencyMs,
        mode: 'raw',
      })
      .then(({ error: e }) => {
        if (e) log.warn('raw_query_history insert failed', { err: e.message });
      });

    return c.json({
      ok: true,
      data: { sql: cleanedSql, results: results.slice(0, 100), rowCount: results.length, latencyMs },
    });
  });
}
