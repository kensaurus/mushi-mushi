// mcp-admin.ts — MCP setup stats and MCP-scoped API routes
//
// Admin (JWT, project-scoped via X-Mushi-Project-Id):
//   GET /v1/admin/mcp/stats — key counts, scope coverage, SDK heartbeat
//
// API-key callers (adminOrApiKey mcp:read):
//   GET /v1/admin/mcp/projects — list projects accessible to this key
//   GET /v1/admin/mcp/logs/:projectId — recent pipeline events for a project

import { Hono } from 'npm:hono@4'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { dbError, ownedProjectIds, resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

// Keep in sync with packages/mcp/src/catalog.ts counts.
// Update when tools/resources/prompts are added.
const TOOL_COUNT = 73
const RESOURCE_COUNT = 8
const PROMPT_COUNT = 4

function hasMcpRead(scopes: string[]): boolean {
  return scopes.includes('mcp:write') || scopes.includes('mcp:read')
}

function hasMcpWrite(scopes: string[]): boolean {
  return scopes.includes('mcp:write')
}

export function registerMcpAdminRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.get('/v1/admin/mcp/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      activeKeyCount: 0,
      mcpReadKeyCount: 0,
      mcpWriteKeyCount: 0,
      connectedKeyCount: 0,
      neverConnectedCount: 0,
      reportOnlyKeyCount: 0,
      lastSeenAt: null as string | null,
      daysSinceLastSeen: null as number | null,
      lastSeenEndpointHost: null as string | null,
      expectedEndpointHost: null as string | null,
      endpointMismatch: false,
      toolCount: TOOL_COUNT,
      resourceCount: RESOURCE_COUNT,
      promptCount: PROMPT_COUNT,
      topPriority: 'no_project' as
        | 'no_project'
        | 'endpoint_mismatch'
        | 'report_only_keys'
        | 'no_mcp_key'
        | 'never_connected'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const project = resolvedProject.project

    const { data: keys, error } = await db
      .from('project_api_keys')
      .select(
        'id, is_active, scopes, last_seen_at, last_seen_endpoint_host, created_at',
      )
      .eq('project_id', project.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      return c.json(
        { ok: false, error: { code: 'DB_ERROR', message: error.message } },
        400,
      )
    }

    const liveKeys = keys ?? []
    let mcpReadKeyCount = 0
    let mcpWriteKeyCount = 0
    let connectedKeyCount = 0
    let neverConnectedCount = 0
    let reportOnlyKeyCount = 0
    let lastSeenAt: string | null = null
    let lastSeenEndpointHost: string | null = null

    for (const k of liveKeys) {
      const scopes = (k.scopes as string[] | null) ?? []
      const mcpRead = hasMcpRead(scopes)
      const mcpWrite = hasMcpWrite(scopes)
      if (mcpRead) mcpReadKeyCount++
      if (mcpWrite) mcpWriteKeyCount++
      if (!mcpRead && !mcpWrite) reportOnlyKeyCount++

      const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null
      if (mcpRead) {
        if (seenAt) {
          connectedKeyCount++
          if (!lastSeenAt || seenAt > lastSeenAt) {
            lastSeenAt = seenAt
            lastSeenEndpointHost =
              (k as { last_seen_endpoint_host?: string | null }).last_seen_endpoint_host ?? null
          }
        } else {
          neverConnectedCount++
        }
      }
    }

    const expectedEndpointHost = (() => {
      try {
        return new URL(c.req.url).host || null
      } catch {
        return null
      }
    })()
    const endpointMismatch =
      !!lastSeenEndpointHost &&
      !!expectedEndpointHost &&
      lastSeenEndpointHost !== expectedEndpointHost

    const daysSinceLastSeen = lastSeenAt
      ? Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / (24 * 60 * 60 * 1000))
      : null

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (endpointMismatch) {
      topPriority = 'endpoint_mismatch'
      topPriorityLabel = `Last heartbeat hit ${lastSeenEndpointHost} — snippet should use ${expectedEndpointHost}.`
      topPriorityTo = '/mcp?tab=setup'
    } else if (mcpReadKeyCount === 0 && reportOnlyKeyCount > 0) {
      topPriority = 'report_only_keys'
      topPriorityLabel = `${reportOnlyKeyCount} active key${reportOnlyKeyCount === 1 ? '' : 's'} with report:write only — mint mcp:read or mcp:write on /projects.`
      topPriorityTo = '/projects'
    } else if (mcpReadKeyCount === 0) {
      topPriority = 'no_mcp_key'
      topPriorityLabel = 'Generate an mcp:read key on /projects, paste the snippet, then ask your agent to list Mushi tools.'
      topPriorityTo = '/projects'
    } else if (neverConnectedCount > 0 && connectedKeyCount === 0) {
      topPriority = 'never_connected'
      topPriorityLabel = `${neverConnectedCount} MCP key${neverConnectedCount === 1 ? '' : 's'} minted — paste .cursor/mcp.json, restart IDE, run "list mushi tools".`
      topPriorityTo = '/mcp?tab=setup'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${mcpReadKeyCount} read · ${mcpWriteKeyCount} write · ${connectedKeyCount} connected · ${TOOL_COUNT} tools advertised.`
      topPriorityTo = '/mcp?tab=catalog'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: project.id as string,
        projectName: (project.name as string | null) ?? null,
        activeKeyCount: liveKeys.length,
        mcpReadKeyCount,
        mcpWriteKeyCount,
        connectedKeyCount,
        neverConnectedCount,
        reportOnlyKeyCount,
        lastSeenAt,
        daysSinceLastSeen,
        lastSeenEndpointHost,
        expectedEndpointHost,
        endpointMismatch,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        promptCount: PROMPT_COUNT,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  // ── MCP-scoped project list (API key + JWT) ────────────────────────────────
  // Returns only the project(s) accessible to the caller's credentials.
  // API-key callers see exactly their bound project; JWT admins see all their
  // projects. This lets `list_projects` tool work for both auth methods.
  parent.get('/v1/admin/mcp/projects', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const db = getServiceClient()
    const authMethod = c.get('authMethod') as string | undefined
    const projectId = c.get('projectId') as string | undefined

    if (authMethod === 'apiKey' && projectId) {
      // API-key caller: return just their bound project
      const { data: project, error } = await db
        .from('projects')
        .select('id, name, created_at, updated_at')
        .eq('id', projectId)
        .maybeSingle()

      if (error) {
        return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
      }
      return c.json({
        ok: true,
        data: { projects: project ? [project] : [], total: project ? 1 : 0 },
      })
    }

    // JWT caller: return all projects owned by this user
    const userId = c.get('userId') as string
    const projectIds = await ownedProjectIds(db, userId)

    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { projects: [], total: 0 } })
    }

    const { data: projects, error } = await db
      .from('projects')
      .select('id, name, created_at, updated_at')
      .in('id', projectIds)
      .order('name', { ascending: true })

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }

    return c.json({
      ok: true,
      data: { projects: projects ?? [], total: (projects ?? []).length },
    })
  })

  // ── MCP pipeline logs (API key + JWT) ─────────────────────────────────────
  // Returns recent pipeline events for a project, aggregated from fix_events,
  // processing_queue, and qa_story_runs. Read-only; project-scoped; scrubbed.
  //
  // Query params: service, since, limit (max 200), level
  parent.get(
    '/v1/admin/mcp/logs/:projectId',
    adminOrApiKey({ scope: 'mcp:read' }),
    async (c) => {
      const db = getServiceClient()
      const authMethod = c.get('authMethod') as string | undefined
      const callerProjectId = c.get('projectId') as string | undefined
      const targetProjectId = c.req.param('projectId')
      if (!targetProjectId) {
        return c.json(
          { ok: false, error: { code: 'PROJECT_ID_REQUIRED', message: 'Project ID is required.' } },
          400,
        )
      }

      // Scope guard: API-key callers may only query their own bound project.
      if (authMethod === 'apiKey' && callerProjectId && callerProjectId !== targetProjectId) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'INSUFFICIENT_SCOPE',
              message: 'API key is not bound to the requested project.',
            },
          },
          403,
        )
      }

      // JWT callers: verify ownership
      if (authMethod === 'jwt') {
        const userId = c.get('userId') as string
        const ownedIds = await ownedProjectIds(db, userId)
        if (!ownedIds.includes(targetProjectId)) {
          return c.json(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } },
            404,
          )
        }
      }

      const rawLimit = parseInt(c.req.query('limit') ?? '50', 10)
      const limit = Math.min(isNaN(rawLimit) ? 50 : rawLimit, 200)
      const since = c.req.query('since') // ISO timestamp
      const service = c.req.query('service') ?? 'all'
      const level = c.req.query('level') ?? 'all'

      const entries: Array<{
        id: string
        service: string
        level: string
        message: string
        ts: string
        detail?: Record<string, unknown> | null
      }> = []

      // ── fix_events (service=fix-worker) ───────────────────────────────────
      if (service === 'all' || service === 'fix-worker') {
        let q = db
          .from('fix_events')
          .select('id, kind, status, label, detail, at, fix_attempt_id, fix_attempts!inner(project_id)')
          .eq('fix_attempts.project_id', targetProjectId)
          .order('at', { ascending: false })
          .limit(Math.min(limit, 50))

        if (since) q = q.gt('at', since)

        const { data: scopedFixEvts, error: fixEventsErr } = await q
        if (fixEventsErr) return dbError(c, fixEventsErr)
        const fixEvts = (scopedFixEvts ?? []) as Array<{
          id: string
          kind: string | null
          status: string | null
          label: string | null
          detail: Record<string, unknown> | null
          at: string | null
          fix_attempt_id: string | null
        }>
        for (const ev of fixEvts ?? []) {
          const isError = (ev.status ?? '') === 'error' || (ev.kind ?? '').includes('error')
          const entryLevel = isError ? 'error' : 'info'
          if (level === 'all' || level === entryLevel || (level === 'warn' && isError)) {
            entries.push({
              id: `fix:${ev.id}`,
              service: 'fix-worker',
              level: entryLevel,
              message: [ev.kind, ev.label].filter(Boolean).join(' — '),
              ts: ev.at as string,
              detail: (ev.detail as Record<string, unknown> | null) ?? null,
            })
          }
        }
      }

      // ── processing_queue (service=pipeline) ───────────────────────────────
      if (service === 'all' || service === 'pipeline') {
        let pq = db
          .from('processing_queue')
          .select('id, status, error_message, updated_at, created_at')
          .eq('project_id', targetProjectId)
          .order('updated_at', { ascending: false })
          .limit(Math.min(limit, 50))

        if (since) pq = pq.gt('updated_at', since)

        const wantErrors = level === 'error' || level === 'warn' || level === 'all'
        if (level === 'error' || level === 'warn') {
          pq = pq.eq('status', 'failed')
        }

        const { data: queueRows } = await pq
        for (const row of queueRows ?? []) {
          const entryLevel =
            (row.status as string) === 'failed'
              ? 'error'
              : (row.status as string) === 'processing'
                ? 'info'
                : 'info'
          if (!wantErrors && entryLevel !== 'info') continue
          entries.push({
            id: `queue:${row.id}`,
            service: 'pipeline',
            level: entryLevel,
            message:
              (row.error_message as string | null) ??
              `Queue item status: ${row.status as string}`,
            ts: (row.updated_at ?? row.created_at) as string,
          })
        }
      }

      // ── qa_story_runs (service=qa-story-runner) ────────────────────────────
      if (service === 'all' || service === 'qa-story-runner') {
        let qsr = db
          .from('qa_story_runs')
          .select('id, status, error_message, latency_ms, started_at, completed_at, story_id')
          .eq('project_id', targetProjectId)
          .order('started_at', { ascending: false })
          .limit(Math.min(limit, 50))

        if (since) qsr = qsr.gt('started_at', since)
        if (level === 'error' || level === 'warn') {
          qsr = qsr.eq('status', 'failed')
        }

        const { data: scopedStoryRuns, error: storyRunsErr } = await qsr
        if (storyRunsErr) return dbError(c, storyRunsErr)
        const storyRuns = (scopedStoryRuns ?? []) as Array<{
          id: string
          status: string | null
          error_message: string | null
          latency_ms: number | null
          started_at: string | null
          completed_at: string | null
          story_id: string | null
        }>
        for (const run of storyRuns ?? []) {
          const isFailed = (run.status as string) === 'failed'
          const entryLevel = isFailed ? 'error' : 'info'
          if ((level === 'error' || level === 'warn') && !isFailed) continue
          entries.push({
            id: `qa:${run.id}`,
            service: 'qa-story-runner',
            level: entryLevel,
            message: isFailed
              ? `QA run failed: ${(run.error_message as string | null) ?? 'unknown error'}`
              : `QA run ${run.status as string} (${run.latency_ms as number | null}ms)`,
            ts: (run.started_at ?? run.completed_at) as string,
          })
        }
      }

      // Sort merged entries by ts descending and cap at limit
      entries.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0))
      const paged = entries.slice(0, limit)

      return c.json({
        ok: true,
        data: {
          project_id: targetProjectId,
          service,
          level,
          since: since ?? null,
          entries: paged,
          count: paged.length,
        },
      })
    },
  )
}
