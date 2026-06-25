/**
 * Loads hosted-tool-manifest.json and builds ToolDef entries for tools
 * not hand-authored in mcp/index.ts — keeps HTTP MCP at catalog parity.
 */

import manifest from '../_shared/mcp-hosted-tool-manifest.json' with { type: 'json' }

export interface ManifestToolDef {
  scope: 'mcp:read' | 'mcp:write'
  description: string
  method: string
  path: string
  required?: string[]
  body?: Record<string, unknown>
  bodyPassthrough?: boolean
  transform?: 'fix_suggest' | 'diagnose_connection' | 'qa_run_pick' | 'backend_health'
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: { authHeaders: Record<string, string>; projectIdHint?: string },
) => Promise<unknown>

export interface ToolDef {
  scope: 'mcp:read' | 'mcp:write'
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  handler: ToolHandler
}

function resolveToken(
  token: string,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): string {
  if (token === 'projectIdHint') return ctx.projectIdHint ?? ''
  if (token.includes('|')) {
    const [key, fallback] = token.split('|')
    const v = args[key] ?? args[key.replace(/([A-Z])/g, '_$1').toLowerCase()]
    return String(v ?? fallback)
  }
  const camel = token
  const snake = token.replace(/([A-Z])/g, '_$1').toLowerCase()
  const v = args[camel] ?? args[snake] ?? (token === 'projectId' || token === 'project_id' ? ctx.projectIdHint : undefined)
  return v != null ? String(v) : ''
}

function interpolatePath(
  template: string,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): string {
  return template.replace(/\{([^}]+)\}/g, (_, raw) => encodeURIComponent(resolveToken(raw, args, ctx)))
}

function buildBody(
  spec: ManifestToolDef,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): string | undefined {
  if (spec.bodyPassthrough) {
    const body = { ...args }
    if (!body.project_id && ctx.projectIdHint) body.project_id = ctx.projectIdHint
    if (!body.projectId && ctx.projectIdHint) body.projectId = ctx.projectIdHint
    return JSON.stringify(body)
  }
  if (!spec.body) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec.body)) {
    if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
      out[k] = resolveToken(v.slice(1, -1), args, ctx) || undefined
    } else {
      out[k] = v
    }
  }
  return JSON.stringify(out)
}

export function buildManifestTools(deps: {
  // Mirrors the real `apiCall` in mcp/index.ts: `init.headers` is required so a
  // manifest tool can never accidentally issue an unauthenticated upstream call.
  apiCall: (
    path: string,
    init: RequestInit & { headers: Record<string, string> },
  ) => Promise<unknown>
  requireString: (v: unknown, name: string) => void
  McpError: new (code: number, message: string) => Error
  ERR_INVALID_PARAMS: number
}): Record<string, ToolDef> {
  const { apiCall, requireString, McpError, ERR_INVALID_PARAMS } = deps
  const out: Record<string, ToolDef> = {}

  for (const [name, spec] of Object.entries(manifest as Record<string, ManifestToolDef>)) {
    out[name] = {
      scope: spec.scope,
      description: spec.description,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: spec.scope === 'mcp:read', openWorldHint: true },
      handler: async (args, ctx) => {
        for (const req of spec.required ?? []) {
          requireString(args[req], req)
        }
        const pid = (args.projectId ?? args.project_id ?? ctx.projectIdHint) as string | undefined

        if (spec.transform === 'fix_suggest') {
          const report = await apiCall(interpolatePath(spec.path, args, ctx), { headers: ctx.authHeaders }) as Record<
            string,
            unknown
          >
          const s2 = report.stage2_analysis as Record<string, unknown> | null | undefined
          return {
            reportId: args.reportId,
            rootCause: s2?.rootCause ?? null,
            suggestedFix: s2?.suggestedFix ?? null,
            reproductionSteps: report.reproduction_steps ?? [],
            summary: report.summary ?? null,
            component: report.component ?? null,
          }
        }

        if (spec.transform === 'diagnose_connection') {
          const ingest = await apiCall('/v1/sync/ingest-setup', { headers: ctx.authHeaders }) as {
            ready?: boolean
            steps?: Array<{ label: string; complete: boolean; required: boolean; hint: string }>
          }
          return {
            ready: Boolean(ingest.ready),
            ingest,
            projectIdHint: ctx.projectIdHint ?? null,
            summary: ingest.ready ? 'Ingest setup complete.' : 'Ingest setup incomplete — see steps.',
          }
        }

        if (spec.transform === 'qa_run_pick') {
          if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required')
          const data = await apiCall(interpolatePath(spec.path, args, ctx), { headers: ctx.authHeaders }) as {
            data?: { runs?: Array<{ id: string }> }
          }
          const run = data?.data?.runs?.find((r) => r.id === args.runId) ?? null
          if (!run) throw new McpError(ERR_INVALID_PARAMS, 'Run not found in recent runs')
          return run
        }

        if (spec.transform === 'backend_health') {
          if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'project_id is required')
          const [schema, advisors, logs] = await Promise.allSettled([
            apiCall(`/v1/admin/projects/${pid}/backend/schema`, { headers: ctx.authHeaders }),
            apiCall(`/v1/admin/projects/${pid}/db-advisors`, { headers: ctx.authHeaders }),
            args.include_logs !== false
              ? apiCall(`/v1/admin/projects/${pid}/backend/logs?service=api`, { headers: ctx.authHeaders })
              : Promise.resolve(null),
          ])
          return {
            schema: schema.status === 'fulfilled' ? schema.value : { error: String(schema.reason) },
            advisors: advisors.status === 'fulfilled' ? advisors.value : { error: String(advisors.reason) },
            logs: logs.status === 'fulfilled' ? logs.value : null,
          }
        }

        const path = interpolatePath(spec.path, args, ctx)
        const init: RequestInit & { headers: Record<string, string> } = {
          headers: ctx.authHeaders,
        }
        if (spec.method !== 'GET') init.method = spec.method
        const body = buildBody(spec, args, ctx)
        if (body) init.body = body
        return apiCall(path, init)
      },
    }
  }

  return out
}
