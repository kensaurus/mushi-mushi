/**
 * backend.ts — Admin routes for deep read-only host-app Supabase inspection.
 *
 * GET /v1/admin/projects/:id/backend/schema
 *   Returns the project's Supabase schema (tables, columns, RLS enabled status),
 *   filtered to the project's declared DbDep table prefixes when present.
 *   Response: { ok: true, data: { tables: TableInfo[]; projectRef: string } }
 *
 * GET /v1/admin/projects/:id/backend/logs?service=api|postgres
 *   Returns recent error logs from the linked Supabase project.
 *   Response: { ok: true, data: { logs: LogEntry[]; service: string } }
 *
 * GET /v1/admin/projects/:id/backend/functions
 *   Returns deployed edge/pg functions in the linked Supabase project.
 *   Response: { ok: true, data: { functions: FunctionInfo[] } }
 *
 * All three endpoints require:
 *   - JWT auth (admin console user)
 *   - Project membership
 *   - `supabase` BYOK key configured (slug: supabase)
 *   - `project_settings.supabase_project_ref` set
 */

import { Hono } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import {
  resolveSupabasePat,
  listTables,
  getLogs,
  listFunctions,
  type TableInfo,
} from '../../_shared/supabase-mcp-client.ts'
import { resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

const NO_PAT_RESPONSE = {
  ok: true,
  data: null,
  reason: 'no_supabase_pat',
  hint:
    'Add your Supabase Personal Access Token in Settings → API Keys (slug: supabase) ' +
    'to enable live backend analysis.',
} as const

const NO_REF_RESPONSE = {
  ok: true,
  data: null,
  reason: 'no_project_ref',
  hint: 'Set `supabase_project_ref` in project settings to enable backend analysis.',
} as const

async function resolveBackendCreds(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<{ pat: string; projectRef: string } | null> {
  const [patResult, settingsResult] = await Promise.all([
    resolveSupabasePat(db, projectId),
    db
      .from('project_settings')
      .select('supabase_project_ref')
      .eq('project_id', projectId)
      .single(),
  ])

  const pat = patResult
  const projectRef = (settingsResult.data as { supabase_project_ref?: string } | null)
    ?.supabase_project_ref

  if (!pat || !projectRef) return null
  return { pat, projectRef }
}

/**
 * Extract declared DbDep table prefixes from the project's inventory graph.
 * Used to filter schema results to only tables this app owns.
 */
async function getDbDepPrefixes(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<string[]> {
  const { data } = await db
    .from('graph_nodes')
    .select('label, metadata')
    .eq('project_id', projectId)
    .eq('node_type', 'db_dep')
    .returns<Array<{ label: string; metadata: Record<string, unknown> | null }>>()

  if (!data?.length) return []

  // A DbDep label may be a table name, a prefix pattern (e.g. "hhtp_*"), or a
  // schema-qualified name. Extract the unique prefixes.
  const prefixes = new Set<string>()
  for (const node of data) {
    const raw = node.label
    if (raw.endsWith('*')) {
      prefixes.add(raw.slice(0, -1))
    } else if (raw.includes('_')) {
      // Use the first segment as the prefix hint (e.g. "hhtp_devices" → "hhtp_")
      const firstSeg = raw.split('_')[0]
      if (firstSeg) prefixes.add(firstSeg + '_')
    }
  }
  return Array.from(prefixes)
}

export function registerBackendRoutes(parent: Hono<{ Variables: Variables }>) {
  // ── Backend spans lookup (trace correlation) ─────────────────────────────

  parent.get('/v1/admin/projects/:id/backend-spans', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const traceId = c.req.query('trace_id')
    const sessionId = c.req.query('session_id')
    const db = getServiceClient()

    if (!traceId && !sessionId) {
      return c.json(
        { ok: false, error: { code: 'MISSING_PARAM', message: 'trace_id or session_id query param required' } },
        400,
      )
    }

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectId,
    })
    if ('response' in resolved) return resolved.response

    let q = db
      .from('backend_spans')
      .select('id, trace_id, session_id, span_json, ingested_at')
      .eq('project_id', projectId)
      .order('ingested_at', { ascending: false })
      .limit(50)

    if (traceId) q = q.eq('trace_id', traceId.toLowerCase())
    if (sessionId) q = q.eq('session_id', sessionId)

    const { data, error } = await q
    if (error) {
      return c.json(
        { ok: false, error: { code: 'DB_ERROR', message: error.message } },
        500,
      )
    }

    return c.json({ ok: true, data: { spans: data ?? [] } })
  })


  // ── Schema ──────────────────────────────────────────────────────────────────

  parent.get('/v1/admin/projects/:id/backend/schema', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const db = getServiceClient()

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectId,
    })
    if ('response' in resolved) return resolved.response

    const creds = await resolveBackendCreds(db, projectId)
    if (!creds?.pat) return c.json(NO_PAT_RESPONSE)
    if (!creds?.projectRef) return c.json(NO_REF_RESPONSE)

    try {
      const prefixes = await getDbDepPrefixes(db, projectId)
      const tables = await listTables(
        { projectRef: creds.projectRef, pat: creds.pat },
        prefixes.length === 1 ? prefixes[0] : undefined,
      )

      // When multiple prefixes, filter in memory.
      const filteredTables: TableInfo[] =
        prefixes.length > 1
          ? tables.filter((t) => prefixes.some((p) => t.name.startsWith(p)))
          : tables

      return c.json({
        ok: true,
        data: {
          tables: filteredTables,
          projectRef: creds.projectRef,
          declaredPrefixes: prefixes,
        },
      })
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SUPABASE_MCP_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        },
        502,
      )
    }
  })

  // ── Logs ────────────────────────────────────────────────────────────────────

  parent.get('/v1/admin/projects/:id/backend/logs', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const service = (c.req.query('service') as 'api' | 'postgres' | undefined) ?? 'api'
    const db = getServiceClient()

    if (service !== 'api' && service !== 'postgres') {
      return c.json(
        { ok: false, error: { code: 'INVALID_PARAM', message: 'service must be api or postgres' } },
        400,
      )
    }

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectId,
    })
    if ('response' in resolved) return resolved.response

    const creds = await resolveBackendCreds(db, projectId)
    if (!creds?.pat) return c.json(NO_PAT_RESPONSE)
    if (!creds?.projectRef) return c.json(NO_REF_RESPONSE)

    try {
      const logs = await getLogs(
        { projectRef: creds.projectRef, pat: creds.pat },
        service,
        { limit: 200, minLevel: 'error' },
      )
      return c.json({ ok: true, data: { logs, service } })
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SUPABASE_MCP_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        },
        502,
      )
    }
  })

  // ── Functions ────────────────────────────────────────────────────────────────

  parent.get('/v1/admin/projects/:id/backend/functions', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const db = getServiceClient()

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectId,
    })
    if ('response' in resolved) return resolved.response

    const creds = await resolveBackendCreds(db, projectId)
    if (!creds?.pat) return c.json(NO_PAT_RESPONSE)
    if (!creds?.projectRef) return c.json(NO_REF_RESPONSE)

    try {
      const functions = await listFunctions({ projectRef: creds.projectRef, pat: creds.pat })
      return c.json({ ok: true, data: { functions, projectRef: creds.projectRef } })
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SUPABASE_MCP_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        },
        502,
      )
    }
  })
}
