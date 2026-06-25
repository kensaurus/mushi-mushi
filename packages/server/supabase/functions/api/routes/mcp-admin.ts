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
import {
  dbError,
  ownedProjectIds,
  callerProjectIds,
  enumerateAccessibleProjectIds,
  resolveOwnedProject,
} from '../shared.ts'
import type { Variables } from '../types.ts'

// Keep in sync with packages/mcp/src/catalog.ts counts.
// Update when tools/resources/prompts are added.
const TOOL_COUNT = 68
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
    const pid = project.id as string
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`

    if (endpointMismatch) {
      topPriority = 'endpoint_mismatch'
      topPriorityLabel = `Your IDE is hitting ${lastSeenEndpointHost} but this console expects ${expectedEndpointHost} — update the MCP snippet endpoint.`
      topPriorityTo = scoped('/mcp?tab=setup')
    } else if (mcpReadKeyCount === 0 && reportOnlyKeyCount > 0) {
      topPriority = 'report_only_keys'
      topPriorityLabel = `${reportOnlyKeyCount} key${reportOnlyKeyCount === 1 ? '' : 's'} can ingest bugs but cannot expose MCP tools — mint mcp:read on Projects.`
      topPriorityTo = scoped('/projects')
    } else if (mcpReadKeyCount === 0) {
      topPriority = 'no_mcp_key'
      topPriorityLabel = 'No MCP key yet — mint mcp:read on Projects, paste the snippet, restart your IDE.'
      topPriorityTo = scoped('/projects')
    } else if (neverConnectedCount > 0 && connectedKeyCount === 0) {
      topPriority = 'never_connected'
      topPriorityLabel = `${neverConnectedCount} MCP key${neverConnectedCount === 1 ? '' : 's'} minted but no heartbeat — paste .cursor/mcp.json and ask the agent to list tools.`
      topPriorityTo = scoped('/mcp?tab=setup')
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${connectedKeyCount} connected · ${TOOL_COUNT} tools ready for your IDE agent.`
      topPriorityTo = scoped('/mcp?tab=catalog')
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

    // JWT caller: return every accessible project (ignore pinned header).
    const userId = c.get('userId') as string
    const projectIds = await enumerateAccessibleProjectIds(c, db, userId)

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

  // ── MCP account overview (API key + JWT) ─────────────────────────────────────
  // Returns all projects accessible to the caller with enriched MCP stats.
  // API-key callers see exactly their bound project; JWT admins see all.
  // Used by the `get_account_overview` MCP tool.
  parent.get('/v1/admin/mcp/account-overview', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const db = getServiceClient()
    const authMethod = c.get('authMethod') as string | undefined
    const apiKeyProjectId = c.get('projectId') as string | undefined
    const userId = c.get('userId') as string | undefined

    // Resolve the set of project IDs in scope for this caller.
    let accessibleIds: string[]
    if (authMethod === 'apiKey') {
      if (apiKeyProjectId) {
        accessibleIds = [apiKeyProjectId]
      } else if (c.get('isOrgScopedKey')) {
        accessibleIds = userId ? await ownedProjectIds(db, userId) : []
      } else {
        accessibleIds = []
      }
    } else if (userId) {
      accessibleIds = await enumerateAccessibleProjectIds(c, db, userId)
    } else {
      return c.json({
        ok: true,
        data: { projects: [], total: 0, toolCount: TOOL_COUNT, resourceCount: RESOURCE_COUNT, promptCount: PROMPT_COUNT },
      })
    }

    if (accessibleIds.length === 0) {
      return c.json({
        ok: true,
        data: { projects: [], total: 0, toolCount: TOOL_COUNT, resourceCount: RESOURCE_COUNT, promptCount: PROMPT_COUNT },
      })
    }

    // Fetch project metadata.
    const { data: projectRows, error: projectsErr } = await db
      .from('projects')
      .select('id, name, created_at')
      .in('id', accessibleIds)
      .order('name', { ascending: true })
    if (projectsErr) return dbError(c, projectsErr)

    // Fetch recent report counts (last 30 days) — best-effort; silently skip on error.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: reportRows } = await db
      .from('reports')
      .select('project_id')
      .in('project_id', accessibleIds)
      .gte('created_at', thirtyDaysAgo)
    const recentCountByProject: Record<string, number> = {}
    for (const r of reportRows ?? []) {
      const pid = r.project_id as string
      recentCountByProject[pid] = (recentCountByProject[pid] ?? 0) + 1
    }

    // Fetch MCP key stats per project.
    const { data: keyRows } = await db
      .from('project_api_keys')
      .select('project_id, scopes, last_seen_at')
      .in('project_id', accessibleIds)
      .eq('is_active', true)
    const mcpStatsByProject: Record<string, { connectedKeyCount: number; lastSeenAt: string | null }> = {}
    for (const k of keyRows ?? []) {
      const pid = k.project_id as string
      const scopes = (k.scopes as string[] | null) ?? []
      if (!hasMcpRead(scopes)) continue
      if (!mcpStatsByProject[pid]) mcpStatsByProject[pid] = { connectedKeyCount: 0, lastSeenAt: null }
      const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null
      if (seenAt) {
        mcpStatsByProject[pid].connectedKeyCount++
        const cur = mcpStatsByProject[pid].lastSeenAt
        if (!cur || seenAt > cur) mcpStatsByProject[pid].lastSeenAt = seenAt
      }
    }

    const projects = (projectRows ?? []).map((p) => {
      const pid = p.id as string
      const stats = mcpStatsByProject[pid] ?? { connectedKeyCount: 0, lastSeenAt: null }
      return {
        id: pid,
        name: (p.name as string | null) ?? null,
        created_at: p.created_at as string,
        recentReportCount: recentCountByProject[pid] ?? 0,
        mcpConnectedKeyCount: stats.connectedKeyCount,
        lastSeenAt: stats.lastSeenAt,
      }
    })

    return c.json({
      ok: true,
      data: {
        projects,
        total: projects.length,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        promptCount: PROMPT_COUNT,
      },
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
        const ownedIds = await callerProjectIds(c, db, userId)
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
          .select('id, status, error_message, latency_ms, started_at, finished_at, story_id')
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
          finished_at: string | null
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
            ts: (run.started_at ?? run.finished_at) as string,
          })
        }
      }

      // ── mcp_tool_invocations (service=mcp) ─────────────────────────────────
      if (service === 'all' || service === 'mcp') {
        let mcpQ = db
          .from('mcp_tool_invocations')
          .select('id, tool_name, scope, transport, status, duration_ms, request_id, error_code, created_at')
          .eq('project_id', targetProjectId)
          .order('created_at', { ascending: false })
          .limit(Math.min(limit, 100))

        if (since) mcpQ = mcpQ.gt('created_at', since)
        if (level === 'error' || level === 'warn') {
          mcpQ = mcpQ.eq('status', 'error')
        }

        const { data: mcpRows, error: mcpErr } = await mcpQ
        if (mcpErr) return dbError(c, mcpErr)
        for (const row of mcpRows ?? []) {
          const isError = (row.status as string) === 'error'
          const entryLevel = isError ? 'error' : 'info'
          if ((level === 'error' || level === 'warn') && !isError) continue
          entries.push({
            id: `mcp:${row.id}`,
            service: 'mcp',
            level: entryLevel,
            message: isError
              ? `MCP tool ${row.tool_name as string} failed (${row.error_code as string | null ?? 'error'})`
              : `MCP tool ${row.tool_name as string} (${row.duration_ms as number}ms)`,
            ts: row.created_at as string,
            detail: {
              tool_name: row.tool_name,
              scope: row.scope,
              transport: row.transport,
              request_id: row.request_id,
            },
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

  // ── Mint org-scoped (account-level) MCP key (JWT only) ───────────────────────
  // Creates an is_org_scoped=true key with no bound project — the key resolves
  // all projects owned by the authenticated user. Equivalent to a Supabase PAT.
  // Returns the raw key for one-time display (not stored; lost if user navigates away).
  parent.post('/v1/admin/mcp/mint-org-key', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    // Validate request body
    const body = await c.req.json().catch(() => ({})) as { scopes?: string[]; label?: string }
    const allowedScopes = ['mcp:read', 'mcp:write'] as const
    const rawScopes: string[] = body.scopes ?? ['mcp:read']
    const invalidScopes = rawScopes.filter((s) => !(allowedScopes as readonly string[]).includes(s))
    if (invalidScopes.length > 0) {
      return c.json(
        { ok: false, error: { code: 'INVALID_SCOPES', message: `Invalid scope(s): ${invalidScopes.join(', ')}. Allowed: ${allowedScopes.join(', ')}` } },
        400,
      )
    }
    const scopes = rawScopes as typeof allowedScopes[number][]

    // Verify the user owns at least one project (sanity guard — no orphan org keys)
    const { data: projects } = await db
      .from('projects')
      .select('id')
      .eq('owner_id', userId)
      .limit(1)
    if (!projects || projects.length === 0) {
      return c.json(
        { ok: false, error: { code: 'NO_PROJECTS', message: 'Create a project before minting an account key.' } },
        400,
      )
    }

    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
    const prefix = rawKey.slice(0, 12)
    const keyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const label = (body.label ?? 'account-mcp-key').slice(0, 64)

    const { error: insertErr } = await db.from('project_api_keys').insert({
      key_hash: keyHash,
      key_prefix: prefix,
      label,
      scopes,
      is_active: true,
      is_org_scoped: true,
      owner_user_id: userId,
      // project_id intentionally omitted (NULL) for org-scoped keys
    })

    if (insertErr) return dbError(c, insertErr)

    return c.json({ ok: true, data: { key: rawKey, prefix, scopes, label, is_org_scoped: true } }, 201)
  })

  /** Live probe of hosted MCP — mints a short-lived read key server-side (no browser secret handling). */
  parent.get('/v1/admin/mcp/test-connection', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'Select a project first.' } }, 400),
    })
    if ('response' in resolved) return resolved.response
    const projectId = resolved.project.id as string

    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
    const prefix = rawKey.slice(0, 12)
    const keyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const { error: insertErr } = await db.from('project_api_keys').insert({
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label: 'mcp-test-probe',
      scopes: ['mcp:read'],
      is_active: true,
    })
    if (insertErr) return dbError(c, insertErr)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!supabaseUrl) {
      return c.json({ ok: false, error: { code: 'MISCONFIGURED', message: 'SUPABASE_URL not set' } }, 500)
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${rawKey}`,
          'X-Mushi-Api-Key': rawKey,
          'X-Mushi-Project-Id': projectId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      })
      const body = (await res.json()) as {
        result?: { tools?: unknown[] }
        error?: { message?: string }
      }
      const count = body.result?.tools?.length ?? 0
      if (!res.ok || body.error) {
        return c.json({
          ok: false,
          error: {
            code: 'MCP_PROBE_FAILED',
            message: body.error?.message ?? `HTTP ${res.status} from hosted MCP`,
          },
        }, 502)
      }
      return c.json({
        ok: true,
        data: {
          tool_count: count,
          expected: TOOL_COUNT,
          healthy: count >= TOOL_COUNT,
        },
      })
    } finally {
      await db
        .from('project_api_keys')
        .update({ is_active: false })
        .eq('key_hash', keyHash)
    }
  })
}
