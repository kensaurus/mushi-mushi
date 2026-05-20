// mcp-admin.ts — MCP setup stats for the admin console KPI strip
//
// Admin (JWT, project-scoped via X-Mushi-Project-Id):
//   GET /v1/admin/mcp/stats — key counts, scope coverage, SDK heartbeat

import { Hono } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

const TOOL_COUNT = 22
const RESOURCE_COUNT = 3
const PROMPT_COUNT = 3

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
      activeKeyCount: 0,
      mcpReadKeyCount: 0,
      mcpWriteKeyCount: 0,
      connectedKeyCount: 0,
      neverConnectedCount: 0,
      reportOnlyKeyCount: 0,
      lastSeenAt: null as string | null,
      lastSeenEndpointHost: null as string | null,
      endpointMismatch: false,
      toolCount: TOOL_COUNT,
      resourceCount: RESOURCE_COUNT,
      promptCount: PROMPT_COUNT,
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

    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null
      } catch {
        return null
      }
    })()
    const endpointMismatch =
      !!lastSeenEndpointHost &&
      !!adminHost &&
      lastSeenEndpointHost !== adminHost

    return c.json({
      ok: true,
      data: {
        activeKeyCount: liveKeys.length,
        mcpReadKeyCount,
        mcpWriteKeyCount,
        connectedKeyCount,
        neverConnectedCount,
        reportOnlyKeyCount,
        lastSeenAt,
        lastSeenEndpointHost,
        endpointMismatch,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        promptCount: PROMPT_COUNT,
      },
    })
  })
}
