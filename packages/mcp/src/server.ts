/**
 * FILE: packages/mcp/src/server.ts
 * PURPOSE: Testable MCP server factory. Exports `createMushiServer()` which
 *          builds a fully-configured `McpServer` but does not connect to any
 *          transport — allowing the stdio entry (`src/index.ts`) and the
 *          in-memory integration tests to share the exact same tool
 *          implementations. Keeping the module side-effect-free is critical:
 *          the old design called `main()` at import time, which made it
 *          impossible to mock `fetch` before the server had wired up its
 *          closures.
 *
 *          Every tool/resource is a thin, typed wrapper over the Mushi REST
 *          API; auth is an API key sent in two headers so the shared
 *          `adminOrApiKey` middleware accepts it regardless of which header
 *          a proxy strips first.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createLogger } from '@mushi-mushi/core'
import {
  TOOL_CATALOG,
  TDD_TOOL_CATALOG,
  CODEBASE_TOOL_CATALOG,
  USE_MUSHI_INTENTS,
  type McpScope,
} from './catalog.js'
import { MUSHI_SERVER_METADATA } from './branding.js'
import { toolMatchesFeatures, DEPRECATED_TOOL_ALIASES, type FeatureFilter } from './feature-groups.js'
import { searchMushiDocs } from './docs-index.js'
import { wrapUntrustedJson, type UntrustedContentRole } from './wrap-untrusted.js'

/** Explicit schema for no-argument MCP tools (avoids ambiguous empty `{}`). */
const NO_ARG_INPUT: Record<string, never> = {}

/**
 * Every admin endpoint returns `{ ok: boolean; data?: T; error?: { code, message } }`.
 * We unwrap that here so each tool body gets `T` directly and error surfacing
 * is consistent — the MCP client sees a real JSON error blob, not a silent
 * empty `data`.
 */
interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

export class MushiApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    // Embed the code in the message so the default MCP error formatter,
    // which only surfaces `error.message`, still carries enough signal
    // for agents to branch on (e.g. INSUFFICIENT_SCOPE → prompt the user
    // to rotate their key). Without this, agents see a bare human
    // sentence and can't distinguish a transient 5xx from a permission
    // denial.
    super(`[${code}] ${message}`)
    this.name = 'MushiApiError'
  }
}

export interface MushiServerConfig {
  /** Server version — surfaced in MCP handshake. Read from package.json by boot. */
  version: string
  /** Base URL of the Mushi API, e.g. https://xyz.supabase.co/functions/v1/api */
  apiEndpoint: string
  /** Project API key with `mcp:read` or `mcp:write` scope. */
  apiKey: string
  /** Optional project hint. Used to scope multi-project tools. */
  projectId?: string
  /**
   * Granted scopes from the API key. When provided, only tools/resources that
   * require a subset of these scopes are registered. Defaults to ALL_SCOPES.
   */
  scopes?: readonly McpScope[]
  /**
   * Fetch implementation — overridable for tests. Tests pass a spy that
   * asserts request shape and returns canned envelopes without hitting the
   * network. Defaults to the global `fetch`.
   */
  fetch?: typeof fetch
  /**
   * Feature groups to expose (`'all'` = every tool including legacy aliases).
   * Set via `MUSHI_FEATURES` env (CSV) on stdio; HTTP uses `?features=` query.
   */
  features?: FeatureFilter
}

/**
 * Build an MCP server instance pre-wired with every Mushi tool, resource,
 * and prompt. Does NOT call `server.connect()` — the caller binds whatever
 * transport they need (stdio for the CLI, InMemoryTransport for tests).
 */
export function createMushiServer(config: MushiServerConfig): McpServer {
  const { version, apiEndpoint, apiKey, projectId } = config
  const doFetch = config.fetch ?? globalThis.fetch
  const apiLog = createLogger({
    scope: 'mushi:mcp:api',
    level: (process.env.MUSHI_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
    destination: 'stderr',
  })

  // Short-circuit for empty scope list: return a bare server with no tools
  // capability. The MCP SDK only advertises `tools` when at least one tool
  // has been registered; returning before any registerTool call means the
  // client sees no `tools` capability and `tools/list` returns -32601.
  if (config.scopes !== undefined && config.scopes.length === 0) {
    return new McpServer({
      name: MUSHI_SERVER_METADATA.name,
      version,
      title: MUSHI_SERVER_METADATA.title,
      websiteUrl: MUSHI_SERVER_METADATA.websiteUrl,
      icons: [...MUSHI_SERVER_METADATA.icons],
    })
  }

  async function apiCall<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    const requestId = crypto.randomUUID().slice(0, 12)
    const started = Date.now()
    const res = await doFetch(`${apiEndpoint}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // Authorization is accepted by `adminOrApiKey` only as a JWT, but we
        // still send it for endpoints still behind plain `jwtAuth` (legacy)
        // and for transparent proxies that strip X-Mushi-* headers.
        'Authorization': `Bearer ${apiKey}`,
        'X-Mushi-Api-Key': apiKey,
        'X-Request-Id': requestId,
        ...(projectId ? { 'X-Mushi-Project-Id': projectId } : {}),
        ...(options?.headers ?? {}),
      },
    })

    const durationMs = Date.now() - started
    const text = await res.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { raw: text }
      }
    }

    if (!res.ok) {
      const envelope = body as ApiEnvelope<T> | null
      const code = envelope?.error?.code ?? `HTTP_${res.status}`
      const message = envelope?.error?.message ?? text.slice(0, 500) ?? `Request failed with ${res.status}`
      apiLog.warn('api.failed', { path, requestId, status: res.status, durationMs, code })
      throw new MushiApiError(res.status, code, message)
    }

    const envelope = body as ApiEnvelope<T>
    if (envelope && typeof envelope === 'object' && 'ok' in envelope) {
      if (!envelope.ok) {
        const code = envelope.error?.code ?? 'API_ERROR'
        const message = envelope.error?.message ?? 'API returned ok=false'
        apiLog.warn('api.failed', { path, requestId, status: res.status, durationMs, code })
        throw new MushiApiError(res.status, code, message)
      }
      apiLog.info('api.done', { path, requestId, status: res.status, durationMs })
      return (envelope.data ?? ({} as T)) as T
    }

    apiLog.info('api.done', { path, requestId, status: res.status, durationMs })
    return body as T
  }

  /**
   * Resolve the effective project ID for a tool call.
   *
   * Resolution order:
   *   1. Caller-supplied explicitId (e.g. from tool argument `projectId`)
   *   2. Server-config projectId (MUSHI_PROJECT_ID env var — single-project mode)
   *   3. Account mode: call list_projects and auto-select the single result.
   *      If the key can reach >1 project, throw with a clear hint listing IDs.
   *
   * This lets agents using an org-scoped (multi-project) key work transparently
   * when they have a single project — and fail with a helpful message when they
   * need to specify which of several projects to target.
   */
  async function resolveProjectId(explicitId?: string | null): Promise<string> {
    if (explicitId) {
      if (projectId && explicitId !== projectId) {
        throw new MushiApiError(
          400,
          'PROJECT_SCOPE_MISMATCH',
          `This MCP entry is bound to project ${projectId}. ` +
            `Either pass projectId="${projectId}", add a second MCP server entry for ${explicitId} ` +
            `(Console → Connect → Add to Cursor while that project is selected), ` +
            'or run `mushi setup --all-projects --ide cursor` for one entry per repo.',
        )
      }
      return explicitId
    }
    if (projectId) return projectId
    // Account mode: probe the API to find accessible projects.
    try {
      const data = await apiCall<{ projects: Array<{ id: string; name?: string | null }>; total: number }>(
        '/v1/admin/mcp/account-overview',
      )
      if (data.total === 1 && data.projects[0]) {
        return data.projects[0].id
      }
      if (data.total === 0) {
        throw new MushiApiError(
          400,
          'NO_ACCESSIBLE_PROJECTS',
          'This API key has no accessible projects. Mint an API key on a project in the admin console.',
        )
      }
      // Multiple projects — caller must specify.
      const projectList = data.projects.map((p) => `${p.name ?? 'unnamed'} (${p.id})`).join(', ')
      throw new MushiApiError(
        400,
        'PROJECT_ID_REQUIRED',
        `Multiple projects are accessible with this key: ${projectList}. ` +
          'Pass projectId explicitly to target a specific project, or set MUSHI_PROJECT_ID in your MCP env config.',
      )
    } catch (err) {
      if (err instanceof MushiApiError) throw err
      throw new MushiApiError(
        400,
        'MISSING_PROJECT_ID',
        'projectId is required. Set MUSHI_PROJECT_ID in .cursor/mcp.json or pass it explicitly.',
      )
    }
  }

  /** Resolve project scope and return optional X-Mushi-Project-Id header. */
  async function projectScopeHeaders(explicitId?: string | null): Promise<{
    projectId: string
    headers: Record<string, string>
  }> {
    const pid = await resolveProjectId(explicitId ?? undefined)
    const headers: Record<string, string> = { 'X-Mushi-Project-Id': pid }
    return { projectId: pid, headers }
  }

  /** Format any value as an MCP text block containing pretty-printed JSON. */
  function jsonText(value: unknown) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    }
  }

  /**
   * Like jsonText but also carries structuredContent for MCP clients that
   * support the 2025-06-18 spec (Cursor 0.48+, Claude Desktop 2025+).
   * Use only for tools that declare an outputSchema.
   */
  function jsonResult(value: unknown) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
      structuredContent: value as Record<string, unknown>,
    }
  }

  /**
   * Prompt-injection-safe variant of jsonText for tools whose results contain
   * user-authored free text (report bodies, NL-query output, lesson text, etc.).
   *
   * The text content block is wrapped with anti-injection delimiters so an LLM
   * that reads it knows the content is DATA, not instructions. MCP clients that
   * consume `structuredContent` are unaffected — they skip the text block.
   *
   * References:
   *   - https://simonwillison.net/2024/Apr/23/sqlite-web/#prompt-injection
   *   - Supabase MCP SQL-result wrapping pattern
   */
  function wrappedJsonText(value: unknown, role: UntrustedContentRole) {
    return {
      content: [{ type: 'text' as const, text: wrapUntrustedJson(value, role) }],
    }
  }

  /** Like wrappedJsonText but also carries structuredContent (for outputSchema tools). */
  function wrappedJsonResult(value: unknown, role: UntrustedContentRole) {
    return {
      content: [{ type: 'text' as const, text: wrapUntrustedJson(value, role) }],
      structuredContent: value as Record<string, unknown>,
    }
  }

  const server = new McpServer({
    name: MUSHI_SERVER_METADATA.name,
    version,
    title: MUSHI_SERVER_METADATA.title,
    websiteUrl: MUSHI_SERVER_METADATA.websiteUrl,
    icons: [...MUSHI_SERVER_METADATA.icons],
  })

  /**
   * Pull the catalog entry for a tool and project its hints into the
   * `annotations` shape `registerTool` expects. Centralising this here means
   * we never forget to translate `readOnly` → `readOnlyHint` for a new tool.
   */
  const ALL_TOOL_CATALOG = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG, ...CODEBASE_TOOL_CATALOG]

  function annotationsFor(name: string, catalog = ALL_TOOL_CATALOG): { title: string; readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean } {
    const spec = catalog.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    const a: { title: string; readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean } = {
      title: spec.title,
      readOnlyHint: spec.hints.readOnly,
    }
    if (spec.hints.destructive !== undefined) a.destructiveHint = spec.hints.destructive
    if (spec.hints.idempotent !== undefined) a.idempotentHint = spec.hints.idempotent
    if (spec.hints.openWorld !== undefined) a.openWorldHint = spec.hints.openWorld
    return a
  }

  function descOf(name: string, catalog = ALL_TOOL_CATALOG): string {
    const spec = catalog.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    return spec.description
  }

  function titleOf(name: string, catalog = ALL_TOOL_CATALOG): string {
    const spec = catalog.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    return spec.title
  }

  // --- Read tools -------------------------------------------------------
  // All tool metadata (description, title, readOnly/destructive hints) comes
  // from `TOOL_CATALOG` so the admin /mcp page and the MCP handshake can't
  // drift. Adding a tool = add a catalog entry + a registerTool call.

  server.registerTool(
    'get_recent_reports',
    {
      title: titleOf('get_recent_reports'),
      description: descOf('get_recent_reports'),
      annotations: annotationsFor('get_recent_reports'),
      inputSchema: {
        status: z.string().optional().describe('Filter by status: new, classified, grouped, fixing, fixed, dismissed'),
        category: z.string().optional().describe('Filter by category: bug, slow, visual, confusing, other'),
        severity: z.string().optional().describe('Filter by severity: critical, high, medium, low'),
        limit: z.number().optional().describe('Max reports to return (default 20, max 100)'),
        project_id: z
          .string()
          .optional()
          .describe(
            'Project UUID — defaults to the server-configured project. ' +
            'Useful when you have multiple projects and want to query a specific one by its ID. ' +
            'Get IDs by calling list_projects or get_account_overview first.',
          ),
      },
      outputSchema: {
        reports: z.array(z.unknown()),
        total: z.number(),
      },
    },
    async (args) => {
      const params = new URLSearchParams()
      if (args.status) params.set('status', args.status)
      if (args.category) params.set('category', args.category)
      if (args.severity) params.set('severity', args.severity)
      params.set('limit', String(Math.min(args.limit ?? 20, 100)))
      const pid = await resolveProjectId(args.project_id)
      const extraHeaders: Record<string, string> = pid !== projectId ? { 'X-Mushi-Project-Id': pid } : {}
      const data = await apiCall<{ reports: unknown[]; total: number }>(`/v1/admin/reports?${params}`, {
        headers: extraHeaders,
      })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'get_report_detail',
    {
      title: titleOf('get_report_detail'),
      description: descOf('get_report_detail'),
      annotations: annotationsFor('get_report_detail'),
      inputSchema: {
        reportId: z.string().describe('The report UUID'),
        project_id: z
          .string()
          .optional()
          .describe('Project UUID — required for org-scoped keys with multiple projects.'),
      },
      outputSchema: { report: z.unknown() },
    },
    async (args) => {
      const { headers } = await projectScopeHeaders(args.project_id)
      const data = await apiCall(`/v1/admin/reports/${args.reportId}`, { headers })
      // Report bodies contain user-authored text — wrap with anti-injection delimiters.
      const res = wrappedJsonResult({ report: data }, 'report body')
      return {
        ...res,
        resource_links: [
          { uri: `project://reports/${args.reportId}`, title: `Report ${args.reportId.slice(0, 8)}…` },
        ],
      }
    },
  )

  server.registerTool(
    'get_report_timeline',
    {
      title: titleOf('get_report_timeline'),
      description: descOf('get_report_timeline'),
      annotations: annotationsFor('get_report_timeline'),
      inputSchema: { reportId: z.string().describe('The report UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/sync/reports/${args.reportId}/timeline`)),
  )

  server.registerTool(
    'get_two_way_comms_health',
    {
      title: titleOf('get_two_way_comms_health'),
      description: descOf('get_two_way_comms_health'),
      annotations: annotationsFor('get_two_way_comms_health'),
      inputSchema: NO_ARG_INPUT,
    },
    async () => jsonText(await apiCall('/v1/sync/two-way-health')),
  )

  server.registerTool(
    'search_reports',
    {
      title: titleOf('search_reports'),
      description: descOf('search_reports'),
      annotations: annotationsFor('search_reports'),
      inputSchema: {
        query: z.string().describe('Natural-language search text or component path'),
        limit: z.number().optional().describe('Max results (default 10, max 50)'),
        threshold: z.number().optional().describe('Similarity threshold 0..1, default 0.2'),
      },
      outputSchema: {
        results: z.array(z.unknown()),
      },
    },
    async (args) => {
      const data = await apiCall<{ results: unknown[] }>('/v1/admin/reports/similarity', {
        method: 'POST',
        body: JSON.stringify({
          query: args.query,
          k: Math.min(args.limit ?? 10, 50),
          threshold: args.threshold ?? 0.2,
          ...(projectId ? { projectId } : {}),
        }),
      })
      // Report titles and descriptions are user-authored — wrap with anti-injection delimiters.
      return wrappedJsonResult(data, 'report description')
    },
  )

  server.registerTool(
    'get_similar_bugs',
    {
      title: titleOf('get_similar_bugs'),
      description: descOf('get_similar_bugs'),
      annotations: annotationsFor('get_similar_bugs'),
      inputSchema: {
        query: z.string().describe('Component name, page path, or bug description'),
        limit: z.number().optional().describe('Max results (default 5, max 20)'),
      },
      outputSchema: {
        results: z.array(z.unknown()),
      },
    },
    async (args) => {
      const data = await apiCall<{ results: unknown[] }>('/v1/admin/reports/similarity', {
        method: 'POST',
        body: JSON.stringify({
          query: args.query,
          k: Math.min(args.limit ?? 5, 20),
          threshold: 0.3,
          ...(projectId ? { projectId } : {}),
        }),
      })
      // Similar-bug descriptions are user-authored — wrap with anti-injection delimiters.
      return wrappedJsonResult(data, 'report description')
    },
  )

  server.registerTool(
    'get_fix_context',
    {
      title: titleOf('get_fix_context'),
      description: descOf('get_fix_context'),
      annotations: annotationsFor('get_fix_context'),
      inputSchema: {
        reportId: z.string().describe('The report UUID to fix'),
        project_id: z
          .string()
          .optional()
          .describe('Project UUID — required for org-scoped keys with multiple projects.'),
      },
      outputSchema: {
        report: z.unknown(),
        fixPrompt: z.unknown(),
        reproductionSteps: z.unknown(),
        component: z.unknown(),
        rootCause: z.unknown(),
        bugOntologyTags: z.unknown(),
      },
    },
    async (args) => {
      const { headers } = await projectScopeHeaders(args.project_id)
      const report = await apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.reportId}`, {
        headers,
      })
      // fix_packet, report body, and rootCause are user-authored or LLM-generated
      // free text — wrap with anti-injection delimiters.
      return wrappedJsonResult({
        report,
        // Paste-ready fix prompt composed server-side by composeFixPacket()
        // (diagnosis + repro + suggested fix + relevant code + blast radius).
        // Hand this straight to the editing agent — no second LLM key needed.
        fixPrompt: report.fix_packet ?? null,
        reproductionSteps: report.reproduction_steps ?? [],
        component: report.component,
        rootCause: (report.stage2_analysis as Record<string, unknown> | undefined)?.rootCause,
        bugOntologyTags: report.bug_ontology_tags,
      }, 'fix context')
    },
  )

  server.registerTool(
    'get_fix_timeline',
    {
      title: titleOf('get_fix_timeline'),
      description: descOf('get_fix_timeline'),
      annotations: annotationsFor('get_fix_timeline'),
      inputSchema: {
        fixId: z.string().describe('fix_attempt UUID'),
        project_id: z
          .string()
          .optional()
          .describe('Project UUID — required for org-scoped keys with multiple projects.'),
      },
    },
    async (args) => {
      const { headers } = await projectScopeHeaders(args.project_id)
      return jsonText(await apiCall(`/v1/admin/fixes/${args.fixId}/timeline`, { headers }))
    },
  )

  server.registerTool(
    'get_blast_radius',
    {
      title: titleOf('get_blast_radius'),
      description: descOf('get_blast_radius'),
      annotations: annotationsFor('get_blast_radius'),
      inputSchema: { nodeId: z.string().describe('Graph node UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/graph/blast-radius/${args.nodeId}`)),
  )

  server.registerTool(
    'get_knowledge_graph',
    {
      title: titleOf('get_knowledge_graph'),
      description: descOf('get_knowledge_graph'),
      annotations: annotationsFor('get_knowledge_graph'),
      inputSchema: {
        seed: z.string().describe('Starting graph node id or human-readable label to traverse from'),
        depth: z.number().optional().describe('BFS hops outward from seed — clamped to 4 in the handler (default 2)'),
      },
      outputSchema: {
        nodes: z.array(z.unknown()).describe('Graph nodes within the depth budget'),
        edges: z.array(z.unknown()).describe('Edges connecting the returned nodes'),
      },
    },
    async (args) => {
      const params = new URLSearchParams({
        seed: args.seed,
        depth: String(Math.min(args.depth ?? 2, 4)),
      })
      const data = await apiCall<{ nodes: unknown[]; edges: unknown[] }>(`/v1/admin/graph/traverse?${params}`)
      return jsonResult(data)
    },
  )

  server.registerTool(
    'get_graph_neighborhood',
    {
      title: titleOf('get_graph_neighborhood'),
      description: descOf('get_graph_neighborhood'),
      annotations: annotationsFor('get_graph_neighborhood'),
      inputSchema: {
        seed: z.string().describe('Starting graph node id or label to expand around (e.g. an inventory Action id or component name)'),
        depth: z.number().int().min(1).max(4).optional().describe('BFS hops to traverse outward. Default 2; clamped to a max of 4.'),
      },
      outputSchema: {
        nodes: z.array(z.unknown()).describe('Graph nodes within the depth budget'),
        edges: z.array(z.unknown()).describe('Edges connecting the returned nodes'),
      },
    },
    async (args) => {
      const params = new URLSearchParams({
        seed: args.seed,
        depth: String(Math.min(args.depth ?? 2, 4)),
      })
      const data = await apiCall<{ nodes: unknown[]; edges: unknown[] }>(`/v1/admin/graph/traverse?${params}`)
      return jsonResult(data)
    },
  )

  server.registerTool(
    'get_graph_node',
    {
      title: titleOf('get_graph_node'),
      description: descOf('get_graph_node'),
      annotations: annotationsFor('get_graph_node'),
      inputSchema: { nodeId: z.string().describe('The graph_nodes.id of the node to fetch (UUID).') },
      outputSchema: {
        node: z.unknown().describe('Single graph_nodes row including metadata (Action nodes carry v2 status)'),
      },
    },
    async (args) => {
      const data = await apiCall<{ node: unknown }>(`/v1/admin/graph/node/${args.nodeId}`)
      return jsonResult(data)
    },
  )

  server.registerTool(
    'get_inventory',
    {
      title: titleOf('get_inventory'),
      description: descOf('get_inventory'),
      annotations: annotationsFor('get_inventory'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to the server-configured project when omitted'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for get_inventory')
      return jsonText(await apiCall(`/v1/admin/inventory/${pid}`))
    },
  )

  server.registerTool(
    'diff_inventory',
    {
      title: titleOf('diff_inventory'),
      description: descOf('diff_inventory'),
      annotations: annotationsFor('diff_inventory'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to configured project'),
        fromSha: z.string().describe('Older commit SHA (the baseline to diff from)'),
        toSha: z.string().describe('Newer commit SHA (the candidate to diff to)'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for diff_inventory')
      const q = new URLSearchParams({ from: args.fromSha, to: args.toSha })
      return jsonText(await apiCall(`/v1/admin/inventory/${pid}/diff?${q}`))
    },
  )

  server.registerTool(
    'list_gate_findings',
    {
      title: titleOf('list_gate_findings'),
      description: descOf('list_gate_findings'),
      annotations: annotationsFor('list_gate_findings'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to configured project'),
        gate: z.string().optional().describe('Filter to one gate id: dead-handler | mock-leak | crawl | status-claim'),
        severity: z.string().optional().describe('Minimum severity to include: low | medium | high | critical'),
      },
      outputSchema: {
        runs: z.array(z.unknown()).describe('Recent gate_runs rows, newest first'),
        findings: z.array(z.unknown()).describe('gate_findings rows for those runs'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for list_gate_findings')
      const q = new URLSearchParams()
      if (args.gate) q.set('gate', args.gate)
      if (args.severity) q.set('severity', args.severity)
      const suffix = q.toString() ? `?${q}` : ''
      const data = await apiCall<{ runs: unknown[]; findings: unknown[] }>(`/v1/admin/inventory/${pid}/findings${suffix}`)
      return jsonResult(data)
    },
  )

  server.registerTool(
    'suggest_fix',
    {
      title: titleOf('suggest_fix'),
      description: descOf('suggest_fix'),
      annotations: annotationsFor('suggest_fix'),
      inputSchema: { reportId: z.string().describe('Report UUID to read the Stage-2 suggested-fix slice for') },
      outputSchema: {
        reportId: z.string().describe('The report this slice was read from'),
        rootCause: z.unknown().describe('Stage-2 root-cause hint, or null if not yet classified'),
        suggestedFix: z.unknown().describe('Stage-2 suggested fix, or null if not yet classified'),
        reproductionSteps: z.unknown().describe('Reproduction steps recorded on the report (array; [] if none)'),
        summary: z.unknown().describe('One-line report summary, or null'),
        component: z.unknown().describe('Component/page the bug was attributed to, or null'),
      },
    },
    async (args) => {
      const report = await apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.reportId}`)
      const s2 = report.stage2_analysis as Record<string, unknown> | null | undefined
      return jsonResult({
        reportId: args.reportId,
        rootCause: s2?.rootCause ?? null,
        suggestedFix: s2?.suggestedFix ?? null,
        reproductionSteps: report.reproduction_steps ?? [],
        summary: report.summary ?? null,
        component: report.component ?? null,
      })
    },
  )

  server.registerTool(
    'run_nl_query',
    {
      title: titleOf('run_nl_query'),
      description: descOf('run_nl_query'),
      annotations: annotationsFor('run_nl_query'),
      inputSchema: { question: z.string().describe('Question in plain English, e.g. "Which components had the most critical bugs this week?"') },
    },
    async (args) => {
      const data = await apiCall('/v1/admin/query', {
        method: 'POST',
        body: JSON.stringify({ question: args.question }),
      })
      // NL-query results may contain user-authored row values — wrap with
      // anti-injection delimiters so the LLM treats them as data, not instructions.
      return wrappedJsonText(data, 'nl-query result')
    },
  )

  // --- Setup / admin tools -----------------------------------------------

  server.registerTool(
    'diagnose_setup',
    {
      title: titleOf('diagnose_setup'),
      description: descOf('diagnose_setup'),
      annotations: annotationsFor('diagnose_setup'),
      inputSchema: {
        mode: z
          .enum(['full', 'ingest', 'dispatch'])
          .optional()
          .describe('full (default) = ingest + dispatch; ingest = SDK pipeline only; dispatch = fix preflight only.'),
        project_id: z.string().optional().describe('Project UUID for dispatch checks (defaults to configured project).'),
        projectId: z.string().optional().describe('Alias for project_id.'),
      },
      outputSchema: {
        mode: z.string(),
        ready: z.boolean(),
        summary: z.string(),
        nextAction: z.string().optional(),
        ingest: z.unknown().optional(),
        dispatch: z.unknown().optional(),
        connection: z.unknown().optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? 'full'
      const resolvedId = args.project_id ?? args.projectId ?? projectId

      if (mode === 'ingest') {
        const data = await apiCall<{
          ready: boolean
          required_complete: number
          required_total: number
          project_id: string
          project_name: string
          steps: Array<{ id: string; label: string; complete: boolean; required: boolean; hint: string }>
          diagnostic?: Record<string, unknown>
        }>('/v1/sync/ingest-setup')
        const failed = data.steps.filter((s) => s.required && !s.complete)
        const summary = data.ready
          ? `Ingest setup complete (${data.required_complete}/${data.required_total}) for ${data.project_name}.`
          : `Ingest incomplete — still need: ${failed.map((s) => s.label).join(', ')}.`
        return jsonResult({
          mode: 'ingest',
          ready: data.ready,
          summary,
          nextAction: failed[0]?.hint,
          ingest: {
            projectId: data.project_id,
            projectName: data.project_name,
            requiredComplete: data.required_complete,
            requiredTotal: data.required_total,
            steps: data.steps,
            diagnostic: data.diagnostic ?? null,
          },
        })
      }

      if (mode === 'dispatch') {
        if (!resolvedId) {
          throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required for dispatch mode')
        }
        const data = await apiCall<{
          ready: boolean
          checks: Array<{ key: string; ready: boolean; label: string; hint: string; fixHref: string }>
          repoUrl: string | null
        }>(`/v1/admin/projects/${resolvedId}/preflight`)
        const failed = data.checks.filter((c) => !c.ready)
        const summary = data.ready
          ? `Project ${resolvedId} is ready to dispatch auto-fixes.`
          : `Dispatch blocked — ${failed.map((c) => c.label).join(', ')}.`
        return jsonResult({
          mode: 'dispatch',
          ready: data.ready,
          summary,
          nextAction: failed[0]?.hint,
          dispatch: { repoUrl: data.repoUrl ?? null, checks: data.checks },
        })
      }

      // ── Connection probes (restored from diagnose_connection) ─────────────
      // These catch INVALID_TOKEN / endpoint / no-projects issues before the
      // ingest/dispatch calls which would surface them as cryptic 401s.
      const connIssues: Array<{ check: string; detail: string; fix: string }> = []
      let healthOk = false

      if (!apiKey?.startsWith('mushi_')) {
        connIssues.push({
          check: 'mcp_api_key',
          detail: 'MCP server API key missing or malformed (expected prefix: mushi_)',
          fix: 'Run `mushi connect` or set MUSHI_API_KEY to a valid key in your MCP config.',
        })
      }
      if (!apiEndpoint) {
        connIssues.push({
          check: 'mcp_endpoint',
          detail: 'No API endpoint configured',
          fix: 'Set MUSHI_API_ENDPOINT to your `.../functions/v1/api` URL in your MCP config.',
        })
      } else {
        try {
          const healthRes = await doFetch(`${apiEndpoint.replace(/\/$/, '')}/health`, {
            signal: AbortSignal.timeout(5000),
          })
          healthOk = healthRes.status === 200
          if (!healthOk) {
            connIssues.push({
              check: 'endpoint_health',
              detail: `GET /health → HTTP ${healthRes.status}`,
              fix: 'Verify MUSHI_API_ENDPOINT and that the Supabase edge function is deployed.',
            })
          }
        } catch (err) {
          connIssues.push({
            check: 'endpoint_health',
            detail: err instanceof Error ? err.message : String(err),
            fix: 'Check network connectivity and MUSHI_API_ENDPOINT in your MCP config.',
          })
        }
      }

      let accessibleProjectCount: number | null = null
      if (!resolvedId && healthOk) {
        try {
          const overview = await apiCall<{ projects: Array<{ id: string }>; total: number }>(
            '/v1/admin/mcp/account-overview',
          )
          accessibleProjectCount = overview.total
          if (overview.total === 0) {
            connIssues.push({
              check: 'no_accessible_projects',
              detail: 'API key has no accessible projects',
              fix: 'Mint an API key on a project (console → Projects → API Keys) or add MUSHI_PROJECT_ID.',
            })
          }
        } catch {
          // Best-effort; health check above already covers connectivity issues.
        }
      }

      const ingest = await apiCall<{
        ready: boolean
        steps: Array<{ label: string; complete: boolean; required: boolean; hint: string }>
        project_name?: string
      }>('/v1/sync/ingest-setup')
      let dispatchReady = true
      let dispatchBlock: string | undefined
      let dispatchChecks: unknown = null
      if (resolvedId) {
        try {
          const preflight = await apiCall<{
            ready: boolean
            checks: Array<{ label: string; ready: boolean; hint: string }>
          }>(`/v1/admin/projects/${resolvedId}/preflight`)
          dispatchReady = preflight.ready
          dispatchChecks = preflight.checks
          if (!preflight.ready) {
            const failed = preflight.checks.filter((c) => !c.ready)
            dispatchBlock = failed[0]?.hint
          }
        } catch (err) {
          dispatchReady = false
          const detail = err instanceof Error ? err.message : String(err)
          dispatchBlock = `Could not run dispatch preflight — ${detail}`
          apiLog.warn('diagnose_setup dispatch preflight failed', { error: detail })
        }
      }
      const ingestFailed = ingest.steps.filter((s) => s.required && !s.complete)
      const ingestBlock = ingestFailed[0]?.hint
      const connOk = connIssues.length === 0
      const ready = connOk && ingest.ready && dispatchReady
      const nextAction = !connOk
        ? (connIssues[0]?.fix ?? 'Fix the connection issue above.')
        : !ingest.ready
        ? (ingestBlock ?? 'Complete SDK ingest setup.')
        : !dispatchReady
        ? (dispatchBlock ?? 'Complete dispatch preflight in Settings → Integrations.')
        : 'All setup checks pass — submit a test report to confirm end-to-end.'
      const summary = ready
        ? 'Mushi connection, ingest, and dispatch setup look healthy.'
        : !connOk
        ? `Connection issue — ${connIssues[0]?.check}: ${connIssues[0]?.detail}`
        : !ingest.ready
        ? `Ingest incomplete — ${ingestFailed.map((s) => s.label).join(', ')}.`
        : 'Ingest OK; dispatch preflight still has blockers.'
      return jsonResult({
        mode: 'full',
        ready,
        summary,
        nextAction,
        connection: {
          healthOk,
          endpoint: apiEndpoint ?? null,
          projectId: resolvedId ?? null,
          accessibleProjectCount,
          issues: connIssues,
        },
        ingest: { ready: ingest.ready, steps: ingest.steps },
        dispatch: resolvedId ? { ready: dispatchReady, checks: dispatchChecks } : null,
      })
    },
  )

  server.registerTool(
    'search_mushi_docs',
    {
      title: titleOf('search_mushi_docs'),
      description: descOf('search_mushi_docs'),
      annotations: annotationsFor('search_mushi_docs'),
      inputSchema: {
        query: z.string().describe('Keywords to search official Mushi docs (guides, MCP, inventory, QA).'),
        limit: z.number().int().min(1).max(20).optional().describe('Max results (default 8).'),
      },
      outputSchema: {
        query: z.string(),
        results: z.array(
          z.object({
            title: z.string(),
            path: z.string(),
            excerpt: z.string(),
            score: z.number(),
          }),
        ),
      },
    },
    async (args) => {
      const query = args.query ?? ''
      const hits = searchMushiDocs(query, args.limit ?? 8)
      const results = hits.map(({ title, path, excerpt, score }) => ({ title, path, excerpt, score }))
      return jsonResult({ query, results })
    },
  )

  // --- Sentry-like triage and project context tools -----------------------

  server.registerTool(
    'list_projects',
    {
      title: titleOf('list_projects'),
      description: descOf('list_projects'),
      annotations: annotationsFor('list_projects'),
      inputSchema: NO_ARG_INPUT,
      outputSchema: {
        projects: z.array(z.unknown()),
        total: z.number().optional(),
        _multi_project_hint: z.string().optional(),
      },
    },
    async () => {
      const data = await apiCall<{ projects: unknown[]; total?: number }>('/v1/admin/mcp/projects')
      return jsonResult({
        ...data,
        _multi_project_hint:
          'Each Mushi project uses a separate API key. To connect another project, ' +
          'open the Mushi console → MCP → Setup, pick the project from the switcher, ' +
          'and click "⚡ Add to Cursor". Each deeplink adds a uniquely-named server entry ' +
          '(mushi-{project-name}-{id-prefix}) so all your projects appear in your IDE simultaneously.',
      })
    },
  )

  server.registerTool(
    'get_account_overview',
    {
      title: titleOf('get_account_overview'),
      description: descOf('get_account_overview'),
      annotations: annotationsFor('get_account_overview'),
      inputSchema: NO_ARG_INPUT,
      outputSchema: {
        projects: z.array(z.unknown()),
        total: z.number(),
        active_project_id: z.string().nullable(),
        toolCount: z.number().optional(),
        resourceCount: z.number().optional(),
        promptCount: z.number().optional(),
        multi_project_hint: z.string(),
      },
    },
    async () => {
      const data = await apiCall<{
        projects: unknown[]
        total: number
        toolCount?: number
        resourceCount?: number
        promptCount?: number
      }>('/v1/admin/mcp/account-overview')
      const projects = Array.isArray(data?.projects) ? data.projects : []
      return jsonResult({
        projects,
        total: data?.total ?? projects.length,
        active_project_id: projectId ?? null,
        toolCount: data?.toolCount,
        resourceCount: data?.resourceCount,
        promptCount: data?.promptCount,
        multi_project_hint:
          projects.length <= 1
            ? 'You are currently connected to one project. To connect additional Mushi projects, ' +
              'open the Mushi console → switch to each project → MCP → Setup → "⚡ Add to Cursor". ' +
              'Each click adds a uniquely-named entry (mushi-{name}-{id}) to your global ~/.cursor/mcp.json ' +
              'so you can triage reports across all your apps from a single Cursor session.'
            : `You have access to ${projects.length} projects. To connect any unconnected project, ` +
              'open the Mushi console → switch to that project → MCP → Setup → "⚡ Add to Cursor".',
      })
    },
  )

  server.registerTool(
    'get_project_context',
    {
      title: titleOf('get_project_context'),
      description: descOf('get_project_context'),
      annotations: annotationsFor('get_project_context'),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID. Defaults to configured project.'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT_ID', 'project_id is required')

      const [preflightRes, activationRes] = await Promise.allSettled([
        apiCall<unknown>(`/v1/admin/projects/${pid}/preflight`),
        apiCall<unknown>(`/v1/admin/activation?project_id=${encodeURIComponent(pid)}`),
      ])

      return jsonText({
        project_id: pid,
        preflight: preflightRes.status === 'fulfilled' ? preflightRes.value : { error: String(preflightRes.reason) },
        activation: activationRes.status === 'fulfilled' ? activationRes.value : { error: String(activationRes.reason) },
      })
    },
  )

  server.registerTool(
    'get_pipeline_logs',
    {
      title: titleOf('get_pipeline_logs'),
      description: descOf('get_pipeline_logs'),
      annotations: annotationsFor('get_pipeline_logs'),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID. Defaults to configured project.'),
        service: z
          .enum(['fix-worker', 'qa-story-runner', 'pipeline', 'all'])
          .optional()
          .describe('Pipeline service to filter (default: all).'),
        since: z.string().optional().describe('ISO-8601 timestamp — return only entries after this time.'),
        limit: z.number().optional().describe('Max entries to return (default 50, max 200).'),
        level: z
          .enum(['info', 'warn', 'error', 'fatal'])
          .optional()
          .describe('Minimum severity level (default: warn).'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT_ID', 'project_id is required')

      const qs = new URLSearchParams()
      if (args.service && args.service !== 'all') qs.set('service', args.service)
      if (args.since) qs.set('since', args.since)
      qs.set('limit', String(Math.min(args.limit ?? 50, 200)))
      if (args.level) qs.set('level', args.level)

      const data = await apiCall<unknown>(`/v1/admin/mcp/logs/${pid}?${qs}`)
      return jsonText(data)
    },
  )

  server.registerTool(
    'get_report_evidence',
    {
      title: titleOf('get_report_evidence'),
      description: descOf('get_report_evidence'),
      annotations: annotationsFor('get_report_evidence'),
      inputSchema: {
        report_id: z.string().describe('Report UUID.'),
      },
    },
    async (args) => {
      const [reportRes, timelineRes] = await Promise.allSettled([
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.report_id}`),
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.report_id}/timeline`),
      ])

      const report = reportRes.status === 'fulfilled' ? reportRes.value : null
      const timeline = timelineRes.status === 'fulfilled' ? timelineRes.value : null

      // Return a focused evidence packet — strip the large classification/fix
      // arrays that belong in get_report_detail, keep only the evidence fields.
      const evidence = report
        ? {
            report_id: args.report_id,
            description: (report as Record<string, unknown>).description,
            summary: (report as Record<string, unknown>).summary,
            screenshot_url: (report as Record<string, unknown>).screenshot_url ?? null,
            environment: (report as Record<string, unknown>).environment ?? null,
            breadcrumbs: (report as Record<string, unknown>).breadcrumbs ?? null,
            sentry_replay_id: (report as Record<string, unknown>).sentry_replay_id ?? null,
            sentry_trace_id: (report as Record<string, unknown>).sentry_trace_id ?? null,
            sentry_event_id: (report as Record<string, unknown>).sentry_event_id ?? null,
            session_id: (report as Record<string, unknown>).session_id ?? null,
            created_at: (report as Record<string, unknown>).created_at,
            tags: (report as Record<string, unknown>).tags ?? null,
          }
        : { error: String((reportRes as PromiseRejectedResult).reason) }

      return jsonText({
        evidence,
        reporter_thread: timeline ?? { error: String((timelineRes as PromiseRejectedResult).reason) },
      })
    },
  )

  server.registerTool(
    'triage_issue',
    {
      title: titleOf('triage_issue'),
      description: descOf('triage_issue'),
      annotations: annotationsFor('triage_issue'),
      inputSchema: {
        report_id: z.string().uuid().describe('Report UUID to triage.'),
        project_id: z.string().optional().describe('Project UUID. Defaults to configured project.'),
        include_logs: z.boolean().optional().describe('Include recent pipeline logs in triage packet (default: true).'),
      },
      outputSchema: {
        report_id: z.string(),
        severity: z.unknown(),
        category: z.unknown(),
        status: z.unknown(),
        report: z.unknown(),
        reporter_thread: z.unknown().nullable(),
        similar_bugs: z.unknown().nullable(),
        fix_context: z.unknown().nullable(),
        blast_radius: z.unknown().nullable(),
        recent_logs: z.unknown().nullable(),
        recommended_actions: z.array(z.unknown()),
        triage_summary: z.string(),
      },
    },
    async (args) => {
      const { projectId: pid, headers } = await projectScopeHeaders(args.project_id)
      const includeLogs = args.include_logs !== false

      const [reportRes, evidenceRes, similarRes, fixCtxRes, blastRes, logsRes] = await Promise.allSettled([
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.report_id}`, { headers }),
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.report_id}/timeline`, { headers }),
        apiCall<unknown>(`/v1/admin/reports/similarity`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ report_id: args.report_id }),
        }).catch(() => null),
        apiCall<unknown>(`/v1/admin/reports/${args.report_id}/fix-context`, { headers }).catch(() => null),
        apiCall<unknown>(`/v1/admin/reports/${args.report_id}/blast-radius`, { headers }).catch(() => null),
        includeLogs
          ? apiCall<unknown>(`/v1/admin/mcp/logs/${pid}?limit=20&level=warn`, { headers }).catch(() => null)
          : Promise.resolve(null),
      ])

      const report = reportRes.status === 'fulfilled' ? reportRes.value : null
      const severity = report ? (report as Record<string, unknown>).severity : 'unknown'
      const category = report ? (report as Record<string, unknown>).category : 'unknown'
      const status = report ? (report as Record<string, unknown>).status : 'unknown'

      // Build recommended next actions based on report state
      const actions: Array<{ action: string; reason: string; tool?: string; args?: Record<string, unknown> }> = []

      if (status === 'new' || status === 'classified') {
        actions.push({
          action: 'dispatch_fix',
          reason: 'Report is classified but no fix has been attempted',
          tool: 'dispatch_fix',
          args: { reportId: args.report_id, agent: 'cursor_cloud' },
        })
      } else if (status === 'fixing') {
        actions.push({
          action: 'check_fix_progress',
          reason: 'Fix is in progress — check the fix timeline for latest status',
          tool: 'get_fix_timeline',
          args: { reportId: args.report_id },
        })
      } else if (status === 'fixed') {
        actions.push({
          action: 'verify_fix',
          reason: 'Fix was applied — verify it resolved the issue',
          tool: 'get_fix_context',
          args: { reportId: args.report_id },
        })
      }

      const partial_errors: string[] = []
      if (reportRes.status === 'rejected') {
        partial_errors.push(`report: ${String(reportRes.reason)}`)
      }
      if (evidenceRes.status === 'rejected') {
        partial_errors.push(`timeline: ${String(evidenceRes.reason)}`)
      }
      if (similarRes.status === 'rejected') {
        partial_errors.push(`similarity: ${String(similarRes.reason)}`)
      }
      if (fixCtxRes.status === 'rejected') {
        partial_errors.push(`fix_context: ${String(fixCtxRes.reason)}`)
      }
      if (blastRes.status === 'rejected') {
        partial_errors.push(`blast_radius: ${String(blastRes.reason)}`)
      }
      if (includeLogs && logsRes.status === 'rejected') {
        partial_errors.push(`recent_logs: ${String(logsRes.reason)}`)
      }

      const result = {
        report_id: args.report_id,
        severity,
        category,
        status,
        partial_errors,
        report: reportRes.status === 'fulfilled' ? reportRes.value : { error: String(reportRes.reason) },
        reporter_thread: evidenceRes.status === 'fulfilled' ? evidenceRes.value : null,
        similar_bugs: similarRes.status === 'fulfilled' ? similarRes.value : null,
        fix_context: fixCtxRes.status === 'fulfilled' ? fixCtxRes.value : null,
        blast_radius: blastRes.status === 'fulfilled' ? blastRes.value : null,
        recent_logs: logsRes.status === 'fulfilled' ? logsRes.value : null,
        recommended_actions: actions,
        triage_summary: `[${severity}] ${category} — status: ${status}. ${actions.length > 0 ? `Recommended: ${actions[0]?.action}.` : 'No action required.'}`,
      }
      const res = jsonResult(result)
      // resource_links let MCP clients (Cursor, Claude Desktop) show a
      // "View report" chip inline — navigates to the canonical resource URI.
      return {
        ...res,
        resource_links: [
          { uri: `project://reports/${args.report_id}`, title: `Report ${args.report_id.slice(0, 8)}…` },
          ...(pid ? [{ uri: `project://dashboard`, title: 'Project dashboard' }] : []),
        ],
      }
    },
  )

  // --- Write / agentic tools -------------------------------------------

  server.registerTool(
    'submit_fix_result',
    {
      title: titleOf('submit_fix_result'),
      description: descOf('submit_fix_result'),
      annotations: annotationsFor('submit_fix_result'),
      inputSchema: {
        reportId: z.string().describe('Report UUID to attach this external fix attempt to'),
        branch: z.string().describe('Git branch name where the fix was implemented'),
        prUrl: z.string().optional().describe('GitHub pull request URL, if a PR was opened'),
        filesChanged: z.array(z.string()).describe('Repo-relative paths modified by the fix'),
        linesChanged: z.number().describe('Total lines added + removed across filesChanged'),
        summary: z.string().describe('One-line human summary of what the fix changed'),
        idempotencyKey: z.string().uuid().optional().describe('Optional UUID — resend the same key to safely retry without creating duplicate fix rows'),
      },
      outputSchema: {
        ok: z.boolean().describe('True when the fix_attempt row was created and marked completed'),
        fixId: z.string().describe('UUID of the new fix_attempt row'),
      },
    },
    async (args) => {
      const idemKey = args.idempotencyKey ?? crypto.randomUUID()
      const created = await apiCall<{ fixId: string }>('/v1/admin/fixes', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: JSON.stringify({ reportId: args.reportId, agent: 'mcp' }),
      })
      await apiCall(`/v1/admin/fixes/${created.fixId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'completed',
          branch: args.branch,
          pr_url: args.prUrl,
          files_changed: args.filesChanged,
          lines_changed: args.linesChanged,
          summary: args.summary,
          completed_at: new Date().toISOString(),
        }),
      })
      return jsonResult({ ok: true, fixId: created.fixId })
    },
  )

  server.registerTool(
    'dispatch_fix',
    {
      title: titleOf('dispatch_fix'),
      description: descOf('dispatch_fix'),
      annotations: annotationsFor('dispatch_fix'),
      inputSchema: {
        reportId: z.string().uuid().describe('Report UUID to fix'),
        agent: z.enum(['claude_code', 'codex', 'rest_worker', 'mcp']).optional().describe('Override the agent adapter'),
        idempotencyKey: z.string().uuid().optional().describe('Optional RFC 4122 UUID. Resend the same key to safely retry without dispatching a duplicate fix job (Idempotency-Key IETF draft).'),
        inventoryActionNodeId: z.string().uuid().optional().describe('Optional inventory Action node UUID for spec-traceability (§2.10). When provided, the fix-worker embeds the expected_outcome contract in the LLM prompt and runs validateAgainstSpec before opening the PR.'),
      },
      outputSchema: {
        fixId: z.string(),
        status: z.string(),
      },
    },
    async (args, extra) => {
      // Long-running: emit a progress ping so MCP clients that support
      // `notifications/progress` can render a live status (Claude Desktop,
      // Cursor 0.47+). Safe no-op on clients that ignore it.
      if (extra?.sendNotification && extra?._meta?.progressToken) {
        try {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken: extra._meta.progressToken,
              progress: 0,
              total: 100,
              message: 'Dispatching Mushi fix orchestrator…',
            },
          })
        } catch { /* client doesn't support progress — fine */ }
      }
      const data = await apiCall('/v1/admin/fixes/dispatch', {
        method: 'POST',
        headers: args.idempotencyKey
          ? { 'Idempotency-Key': args.idempotencyKey }
          : undefined,
        body: JSON.stringify({
          reportId: args.reportId,
          agent: args.agent,
          inventoryActionNodeId: args.inventoryActionNodeId,
          ...(projectId ? { projectId } : {}),
        }),
      })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'trigger_judge',
    {
      title: titleOf('trigger_judge'),
      description: descOf('trigger_judge'),
      annotations: annotationsFor('trigger_judge'),
      inputSchema: {
        limit: z.number().optional().describe('Max reports to judge in this batch (default 25, max 100)'),
        projectId: z.string().optional().describe('Restrict to one project when the API key owns multiple'),
      },
      outputSchema: {
        dispatched: z.number().describe('Number of judge-batch jobs dispatched (one per accessible project)'),
      },
    },
    async (args) => {
      const data = await apiCall<{ dispatched: number }>('/v1/admin/judge/run', {
        method: 'POST',
        body: JSON.stringify({
          limit: Math.min(args.limit ?? 25, 100),
          projectId: args.projectId ?? projectId ?? undefined,
        }),
      })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'test_gen_from_report',
    {
      title: titleOf('test_gen_from_report'),
      description: descOf('test_gen_from_report'),
      annotations: annotationsFor('test_gen_from_report'),
      inputSchema: {
        reportId: z.string().describe('Report UUID to turn into a Playwright PR'),
        projectId: z.string().optional().describe('Project UUID — defaults to configured project'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for test_gen_from_report')
      const data = await apiCall(`/v1/admin/inventory/${pid}/test-gen/from-report/${args.reportId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      return jsonText(data)
    },
  )

  server.registerTool(
    'merge_fix',
    {
      title: titleOf('merge_fix'),
      description: descOf('merge_fix'),
      annotations: annotationsFor('merge_fix'),
      inputSchema: {
        fixId: z.string().describe('Fix attempt UUID whose GitHub PR should be squash-merged'),
        mergeMethod: z.enum(['squash', 'merge', 'rebase']).optional().describe('GitHub merge method (default squash)'),
      },
      outputSchema: {
        merged: z.boolean().optional().describe('True when GitHub accepted the merge in this call'),
        alreadyMerged: z.boolean().optional().describe('True when the PR was already merged (idempotent no-op)'),
        reportId: z.string().describe('Report UUID linked to this fix attempt'),
        reportStatus: z.string().describe('Report workflow status after merge bookkeeping'),
      },
    },
    async (args) => {
      const data = await apiCall<{
        merged?: boolean
        alreadyMerged?: boolean
        reportId: string
        reportStatus: string
      }>(`/v1/admin/fixes/${args.fixId}/merge`, {
        method: 'POST',
        body: JSON.stringify({ mergeMethod: args.mergeMethod ?? 'squash' }),
      })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'refresh_ci',
    {
      title: titleOf('refresh_ci'),
      description: descOf('refresh_ci'),
      annotations: annotationsFor('refresh_ci'),
      inputSchema: {
        fixId: z.string().describe('Fix attempt UUID whose PR check-runs should be re-polled'),
      },
      outputSchema: {
        check_run_status: z.string().nullable().describe('GitHub check run status after refresh'),
        check_run_conclusion: z.string().nullable().describe('success | failure | neutral | null while pending'),
        check_run_updated_at: z.string().nullable().describe('ISO timestamp when CI status was last persisted'),
      },
    },
    async (args) => {
      const data = await apiCall<{
        check_run_status: string | null
        check_run_conclusion: string | null
        check_run_updated_at: string | null
      }>(`/v1/admin/fixes/${args.fixId}/refresh-ci`, { method: 'POST' })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'reopen_report',
    {
      title: titleOf('reopen_report'),
      description: descOf('reopen_report'),
      annotations: annotationsFor('reopen_report'),
      inputSchema: {
        reportId: z.string().describe('Report UUID to move back to reopened status'),
        note: z.string().optional().describe('Operator note recorded on the reopen transition'),
      },
      outputSchema: {
        report: z.unknown().describe('Updated report row with status=reopened'),
      },
    },
    async (args) => {
      const report = await apiCall<unknown>(`/v1/sync/reports/${args.reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'reopened', note: args.note }),
      })
      return jsonResult({ report })
    },
  )

  server.registerTool(
    'transition_status',
    {
      title: titleOf('transition_status'),
      description: descOf('transition_status'),
      annotations: annotationsFor('transition_status'),
      inputSchema: {
        reportId: z.string().describe('Report UUID'),
        status: z.enum(['pending', 'classified', 'grouped', 'fixing', 'fixed', 'resolved', 'verified', 'reopened', 'dismissed']).describe('Target status'),
        reason: z.string().optional().describe('Reason for the transition (audit trail)'),
      },
    },
    async (args) => {
      const data = await apiCall(`/v1/admin/reports/${args.reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: args.status, reason: args.reason }),
      })
      return jsonText(data)
    },
  )

  server.registerTool(
    'setup_repo_for_mushi',
    {
      title: titleOf('setup_repo_for_mushi'),
      description: descOf('setup_repo_for_mushi'),
      annotations: annotationsFor('setup_repo_for_mushi'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to configured project'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for setup_repo_for_mushi')
      const data = await apiCall(`/v1/admin/projects/${pid}/repo/bootstrap`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      return jsonText(data)
    },
  )

  server.registerTool(
    'query_lessons',
    {
      title: titleOf('query_lessons'),
      description: descOf('query_lessons'),
      annotations: annotationsFor('query_lessons'),
      inputSchema: {
        diff_text: z.string().describe('The PR diff, code snippet, or description of the change being made.'),
        max_tokens: z.number().optional().describe('Maximum tokens for returned lessons context (default 3000, max 8000).'),
        top_k: z.number().optional().describe('Max number of lessons to return (default 15, max 50).'),
        project_id: z.string().optional().describe('Project UUID. Defaults to configured project.'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      const data = await apiCall<unknown>('/v1/admin/lessons/query', {
        method: 'POST',
        body: JSON.stringify({
          diff_text: args.diff_text,
          ...(args.max_tokens !== undefined ? { max_tokens: args.max_tokens } : {}),
          ...(args.top_k !== undefined ? { top_k: args.top_k } : {}),
          ...(pid ? { project_id: pid } : {}),
        }),
      })
      // Lesson text is user-authored/AI-generated — wrap with anti-injection delimiters.
      return wrappedJsonText(data, 'lesson text')
    },
  )

  server.registerTool(
    'list_lessons',
    {
      title: titleOf('list_lessons'),
      description: descOf('list_lessons'),
      annotations: annotationsFor('list_lessons'),
      inputSchema: {
        severity: z.enum(['info', 'warn', 'critical']).optional().describe('Filter to one severity level'),
        limit: z.number().optional().describe('Max lessons to return (default 50, max 200)'),
        project_id: z.string().optional().describe('Project UUID — defaults to configured project'),
      },
      outputSchema: {
        lessons: z.array(z.unknown()).describe('Promoted lesson rows ordered by frequency'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      const params = new URLSearchParams()
      if (args.severity) params.set('severity', args.severity)
      params.set('limit', String(Math.min(args.limit ?? 50, 200)))
      if (pid) params.set('projectId', pid)
      const lessons = await apiCall<unknown[]>(`/v1/admin/lessons?${params}`)
      // Lesson text is user-authored/AI-generated — wrap with anti-injection delimiters.
      return wrappedJsonResult({ lessons }, 'lesson text')
    },
  )

  // --- Resources (stdio only — hosted HTTP exposes these as separate tools) ---

  server.resource(
    'project_stats',
    'project://stats',
    { description: 'Report counts, category breakdown, severity distribution' },
    async () => ({
      contents: [{ uri: 'project://stats', mimeType: 'application/json', text: JSON.stringify(await apiCall('/v1/admin/stats'), null, 2) }],
    }),
  )

  server.resource(
    'project_settings',
    'project://settings',
    { description: 'Project configuration — autofix agent, plugins enabled, ontology, LLM budgets' },
    async () => ({
      contents: [{ uri: 'project://settings', mimeType: 'application/json', text: JSON.stringify(await apiCall('/v1/admin/settings'), null, 2) }],
    }),
  )

  server.resource(
    'project_dashboard',
    'project://dashboard',
    { description: 'PDCA health snapshot — stage counts, bottleneck, recent activity (same payload the admin console polls)' },
    async () => ({
      contents: [{ uri: 'project://dashboard', mimeType: 'application/json', text: JSON.stringify(await apiCall('/v1/admin/dashboard'), null, 2) }],
    }),
  )

  // --- Rewards tools (P3) -------------------------------------------------

  server.registerTool(
    'list_top_contributors',
    {
      title: titleOf('list_top_contributors'),
      description: descOf('list_top_contributors'),
      annotations: annotationsFor('list_top_contributors'),
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(10).describe('Max rows to return (default 10, max 100)'),
        range: z.enum(['30d', '90d', 'all']).optional().default('30d').describe('Time window for points calculation'),
      },
    },
    async ({ limit, range }) => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify(
          await apiCall(`/v1/admin/rewards/leaderboard?range=${range}&limit=${limit}`),
          null, 2,
        ),
      }],
    }),
  )

  server.registerTool(
    'award_bonus_points',
    {
      title: titleOf('award_bonus_points'),
      description: descOf('award_bonus_points'),
      annotations: annotationsFor('award_bonus_points'),
      inputSchema: {
        external_user_id: z.string().describe('The host-app user id as passed to Mushi.identify()'),
        points: z.number().int().min(1).max(50000).describe('Bonus points to award (max 50,000 per call)'),
        reason: z.string().max(200).describe('Human-readable reason, logged to end_user_activity'),
      },
    },
    async ({ external_user_id, points, reason }) => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify(
          await apiCall('/v1/admin/rewards/bonus-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ external_user_id, points, reason }),
          }),
          null, 2,
        ),
      }],
    }),
  )

  server.registerTool(
    'set_tier',
    {
      title: titleOf('set_tier'),
      description: descOf('set_tier'),
      annotations: annotationsFor('set_tier'),
      inputSchema: {
        external_user_id: z.string().describe('The host-app user id as passed to Mushi.identify()'),
        tier_slug: z.string().describe('Tier slug to assign, e.g. "champion", "contributor", "explorer"'),
        reason: z.string().max(200).optional().describe('Optional reason for manual override'),
      },
    },
    async ({ external_user_id, tier_slug, reason }) => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify(
          await apiCall('/v1/admin/rewards/set-tier', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ external_user_id, tier_slug, reason }),
          }),
          null, 2,
        ),
      }],
    }),
  )

  server.resource(
    'privacy_status',
    'privacy://status',
    {
      description:
        'Returns the privacy posture for this project: storage region, LLM provider, whether BYOK is configured, ' +
        'data retention window, and last audit timestamp.',
    },
    async () => ({
      contents: [{
        uri: 'privacy://status',
        mimeType: 'application/json',
        text: JSON.stringify(await apiCall('/v1/admin/privacy-status'), null, 2),
      }],
    }),
  )

  server.resource(
    'evolution_history',
    'evolution://history',
    {
      description:
        'Returns the project\'s last 30 days of judge scores, prompt promotions, fixed-bug count, and lesson inductions. ' +
        'Agents can read this to see whether the loop is converging (rising judge scores, falling recurrence) or stalling.',
    },
    async () => ({
      contents: [{
        uri: 'evolution://history',
        mimeType: 'application/json',
        text: projectId
          ? JSON.stringify(
              await apiCall(`/v1/admin/projects/${encodeURIComponent(projectId)}/evolution-history`),
              null,
              2,
            )
          : JSON.stringify({ ok: false, error: 'project_id required' }),
      }],
    }),
  )

  server.resource(
    'project_integration_health',
    'project://integration-health',
    {
      description:
        'Live health status of every configured BYOK channel (Sentry, GitHub, LangFuse, PagerDuty, …). ' +
        'Orchestrators should check this before dispatching a fix to fail-fast on broken channels ' +
        'rather than burning LLM budget and discovering the failure mid-run.',
    },
    async () => ({
      contents: [{
        uri: 'project://integration-health',
        mimeType: 'application/json',
        text: JSON.stringify(await apiCall('/v1/admin/integrations/health'), null, 2),
      }],
    }),
  )

  server.resource(
    'inventory_current',
    'inventory://current',
    {
      description:
        'Current inventory snapshot for the active project — all Action nodes with their ' +
        'spec contract (expected_outcome), build-gate status, linked reports, and fix attempts. ' +
        'Subscribe to this resource to receive notifications/resources/updated when the inventory ' +
        'is re-crawled (e.g. after a PR merge or manual trigger). ' +
        'Orchestrators can use this to enumerate work items and pick the next Action to fix.',
    },
    async () => {
      const path = projectId
        ? `/v1/admin/inventory/${projectId}`
        : '/v1/admin/inventory'
      return {
        contents: [{
          uri: 'inventory://current',
          mimeType: 'application/json',
          text: JSON.stringify(await apiCall(path), null, 2),
        }],
      }
    },
  )

  // Thin tool wrapper so tool-callers and resource-readers both work.
  // The resource below exposes the same data via mushi://activation URI.
  server.registerTool(
    'activation_status',
    {
      title: titleOf('activation_status'),
      description: descOf('activation_status'),
      annotations: annotationsFor('activation_status'),
      inputSchema: {
        project_id: z
          .string()
          .optional()
          .describe('Project UUID (defaults to the configured project).'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      const qs = pid ? `?project_id=${encodeURIComponent(pid)}` : ''
      return jsonResult(await apiCall(`/v1/admin/activation${qs}`))
    },
  )

  server.resource(
    'activation_status',
    'mushi://activation',
    {
      description:
        'Unified setup posture — SDK heartbeat, reports, GitHub, MCP readiness, QA stories, and the next best action.',
    },
    async () => {
      const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      return {
        contents: [{
          uri: 'mushi://activation',
          mimeType: 'application/json',
          text: JSON.stringify(await apiCall(`/v1/admin/activation${qs}`), null, 2),
        }],
      }
    },
  )

  // --- Prompts ---------------------------------------------------------

  server.prompt(
    'summarize_report_for_fix',
    'Turn a Mushi report into a one-line root cause, smallest file set, repro steps, and blast-radius warnings. Use before asking an agent to write the patch.',
    { reportId: z.string().describe('The report UUID to summarize') },
    ({ reportId }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are a senior engineer preparing a fix plan. Use the Mushi MCP tools to:\n` +
            `1. Call get_fix_context for reportId "${reportId}".\n` +
            `2. Call get_blast_radius if the report has a component node id.\n` +
            `3. Call get_similar_bugs with the component or summary as the query.\n\n` +
            `Then produce a markdown fix plan with exactly these sections:\n` +
            `- One-line root cause\n` +
            `- Files likely to change (smallest set that fixes the root cause)\n` +
            `- Reproduction steps (numbered, ≤5)\n` +
            `- Blast-radius warnings (what else might break)\n` +
            `- Confidence (low/medium/high) with a one-line justification\n\n` +
            `Lead with the fix. Skip the preamble.`,
        },
      }],
    }),
  )

  server.prompt(
    'explain_judge_result',
    'Turn raw Sonnet-as-Judge scores into ship / iterate / dismiss guidance. Use after a fix attempt has been judged.',
    { fixId: z.string().describe('The fix_attempt UUID to explain') },
    ({ fixId }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are a release engineer. Use the Mushi MCP tools:\n` +
            `1. Call get_fix_timeline for fixId "${fixId}" to see the full PDCA journey.\n\n` +
            `Then write a short verdict in this format:\n` +
            `- **Recommendation:** ship / iterate / dismiss\n` +
            `- **Why:** 1–2 sentences referencing the judge scores and CI signal\n` +
            `- **If iterate:** bullet list of the smallest next patch\n\n` +
            `No preamble, no score-by-score recap — the numbers are in the tool output.`,
        },
      }],
    }),
  )

  server.prompt(
    'triage_next_steps',
    'Answer "what should I focus on right now?" — five-item markdown list drawn from the dashboard + recent classified queue.',
    {},
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are a tech lead looking at the Mushi cockpit. Use the MCP tools:\n` +
            `1. Read the project://dashboard resource for the PDCA snapshot.\n` +
            `2. Call get_recent_reports with status="classified", limit=10.\n\n` +
            `Then output exactly 5 bullets, in priority order, each formatted as:\n` +
            `\`**Action** — why it matters — suggested tool call\`\n\n` +
            `Prefer items that are bottlenecks or critical severity. Skip filler.`,
        },
      }],
    }),
  )

  server.prompt(
    'mushi_setup',
    'Diagnose why Mushi setup is stuck and return the single next command or console step to unblock it.',
    {},
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are a Mushi onboarding copilot. Use the MCP tools:\n` +
            `1. Read mushi://activation for unified setup posture.\n` +
            `2. Read project://integration-health if GitHub or Sentry looks blocked.\n` +
            `3. Call diagnose_setup if the resource is unavailable.\n\n` +
            `Then output:\n` +
            `- **Status:** one sentence on what is done vs blocked\n` +
            `- **Next step:** the single highest-leverage action (console link or CLI command)\n` +
            `- **Prove it:** how the user verifies the step worked\n` +
            `- **If still stuck:** one diagnostic command (e.g. mushi doctor --fix)\n\n` +
            `Be specific. No generic advice.`,
        },
      }],
    }),
  )

  // ── Phase 4: TDD / Story-mapping tools ──────────────────────────────────

  server.registerTool(
    'map_user_stories',
    {
      title: titleOf('map_user_stories', TDD_TOOL_CATALOG),
      description: descOf('map_user_stories', TDD_TOOL_CATALOG),
      annotations: annotationsFor('map_user_stories', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id to map stories for'),
        baseUrl: z.string().url().describe('Live app URL to crawl'),
        maxPages: z.number().int().min(1).max(50).optional().describe('Max pages to crawl (default 20)'),
        provider: z.enum(['firecrawl', 'browserbase']).optional().describe('Crawl provider (default: firecrawl)'),
        cursorCloudRefine: z.boolean().optional().describe('Dispatch Cursor Cloud agent to refine and open a PR'),
      },
    },
    async ({ projectId, baseUrl, maxPages, provider, cursorCloudRefine }) => {
      if (!projectId) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required')
      const data = await apiCall<{ runId: string; status: string }>(
        `/v1/admin/inventory/${projectId}/map-from-live`,
        { method: 'POST', body: JSON.stringify({ base_url: baseUrl, max_pages: maxPages, provider, cursor_cloud_refine: cursorCloudRefine }) },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'get_map_run_status',
    {
      title: titleOf('get_map_run_status', TDD_TOOL_CATALOG),
      description: descOf('get_map_run_status', TDD_TOOL_CATALOG),
      annotations: annotationsFor('get_map_run_status', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id'),
      },
    },
    async ({ projectId }) => {
      const data = await apiCall<{ runs: unknown[] }>(`/v1/admin/inventory/${projectId}/map-runs`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'generate_tdd_from_story',
    {
      title: titleOf('generate_tdd_from_story', TDD_TOOL_CATALOG),
      description: descOf('generate_tdd_from_story', TDD_TOOL_CATALOG),
      annotations: annotationsFor('generate_tdd_from_story', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project UUID that owns the inventory story'),
        storyNodeId: z.string().describe('User story node id/slug from accepted inventory (from map_user_stories or inventory.yaml)'),
        automationMode: z.enum(['auto', 'review', 'approve']).optional().describe('Approval gate for the generated qa_story (default review → pending_review)'),
        baseUrl: z.string().url().optional().describe('Override the live app URL the Playwright test should target'),
        openPr: z.boolean().optional().describe('Open a draft GitHub PR with the generated spec (default true)'),
      },
      outputSchema: {
        qaStoryId: z.string().describe('UUID of the inserted qa_stories row'),
        prUrl: z.string().nullable().describe('GitHub PR URL when openPr=true and GitHub is connected'),
        approvalStatus: z.string().describe('pending_review | approved — follows automationMode and project defaults'),
        needsHumanReview: z.boolean().describe('True when the story requires operator approval before scheduled runs'),
      },
    },
    async ({ projectId, storyNodeId, automationMode, baseUrl, openPr }) => {
      if (!projectId) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required')
      const data = await apiCall<{
        qaStoryId: string
        prUrl: string | null
        approvalStatus: string
        needsHumanReview: boolean
      }>(
        `/v1/admin/inventory/${projectId}/stories/${storyNodeId}/generate-test`,
        { method: 'POST', body: JSON.stringify({ automation_mode: automationMode, base_url: baseUrl, open_pr: openPr }) },
      )
      return jsonResult(data)
    },
  )

  server.registerTool(
    'improve_qa_story',
    {
      title: titleOf('improve_qa_story', TDD_TOOL_CATALOG),
      description: descOf('improve_qa_story', TDD_TOOL_CATALOG),
      annotations: annotationsFor('improve_qa_story', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().optional().describe('Project id (omit to run across all projects)'),
      },
    },
    async ({ projectId }) => {
      const data = await apiCall<{ improved: number }>(
        '/v1/admin/pdca/improve-qa-stories',
        { method: 'POST', body: JSON.stringify({ project_id: projectId }) },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'run_qa_story',
    {
      title: titleOf('run_qa_story', TDD_TOOL_CATALOG),
      description: descOf('run_qa_story', TDD_TOOL_CATALOG),
      annotations: annotationsFor('run_qa_story', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id'),
        qaStoryId: z.string().describe('qa_story id to run'),
      },
    },
    async ({ projectId, qaStoryId }) => {
      const data = await apiCall<unknown>(
        `/v1/admin/projects/${projectId}/qa-stories/${qaStoryId}/run`,
        { method: 'POST' },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'list_byok_keys',
    {
      title: titleOf('list_byok_keys', TDD_TOOL_CATALOG),
      description: descOf('list_byok_keys', TDD_TOOL_CATALOG),
      annotations: annotationsFor('list_byok_keys', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id'),
      },
    },
    async ({ projectId }) => {
      const data = await apiCall<unknown>(`/v1/admin/byok/keys?project_id=${encodeURIComponent(projectId)}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'add_byok_key',
    {
      title: titleOf('add_byok_key', TDD_TOOL_CATALOG),
      description: descOf('add_byok_key', TDD_TOOL_CATALOG),
      annotations: annotationsFor('add_byok_key', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id'),
        provider: z.enum(['anthropic', 'openai', 'firecrawl', 'browserbase', 'cursor']).describe('Provider slug'),
        key: z.string().min(10).describe('The API key value to add'),
        label: z.string().optional().describe('Human-readable label for this key'),
        priority: z.number().int().min(1).max(999).optional().describe('Priority for ordering (lower = higher priority)'),
      },
    },
    async ({ projectId, provider, key, label, priority }) => {
      const data = await apiCall<unknown>(
        '/v1/admin/byok/keys',
        { method: 'POST', body: JSON.stringify({ project_id: projectId, provider_slug: provider, key, label, priority }) },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'list_pending_review_stories',
    {
      title: titleOf('list_pending_review_stories', TDD_TOOL_CATALOG),
      description: descOf('list_pending_review_stories', TDD_TOOL_CATALOG),
      annotations: annotationsFor('list_pending_review_stories', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id'),
      },
    },
    async ({ projectId }) => {
      const data = await apiCall<unknown>(`/v1/admin/inventory/${projectId}/stories/pending-review`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'approve_qa_story',
    {
      title: titleOf('approve_qa_story', TDD_TOOL_CATALOG),
      description: descOf('approve_qa_story', TDD_TOOL_CATALOG),
      annotations: annotationsFor('approve_qa_story', TDD_TOOL_CATALOG),
      inputSchema: {
        projectId: z.string().describe('Project id'),
        qaStoryId: z.string().describe('QA story id to approve or reject'),
        status: z.enum(['approved', 'rejected']).describe('New approval status'),
      },
    },
    async ({ projectId, qaStoryId, status }) => {
      const data = await apiCall<unknown>(
        `/v1/admin/inventory/${projectId}/stories/${qaStoryId}/approval`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'reply_to_reporter',
    {
      title: titleOf('reply_to_reporter', TDD_TOOL_CATALOG),
      description: descOf('reply_to_reporter', TDD_TOOL_CATALOG),
      annotations: annotationsFor('reply_to_reporter', TDD_TOOL_CATALOG),
      inputSchema: {
        reportId: z.string().describe('Report id to reply to'),
        message: z.string().min(1).max(10_000).describe('Message text to send to the reporter'),
        authorName: z.string().optional().describe('Display name for the admin sender (default: "Mushi Admin")'),
      },
    },
    async ({ reportId, message, authorName }) => {
      const data = await apiCall<unknown>(
        `/v1/sync/reports/${reportId}/reply`,
        {
          method: 'POST',
          body: JSON.stringify({ message, author_name: authorName }),
        },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'list_qa_story_runs',
    {
      title: titleOf('list_qa_story_runs', TDD_TOOL_CATALOG),
      description: descOf('list_qa_story_runs', TDD_TOOL_CATALOG),
      annotations: annotationsFor('list_qa_story_runs', TDD_TOOL_CATALOG),
      inputSchema: {
        storyId: z.string().describe('QA story id (uuid)'),
        limit: z.number().int().min(1).max(50).optional().default(10).describe('Max runs to return (default 10)'),
      },
    },
    async ({ storyId, limit }) => {
      const data = await apiCall<unknown>(
        `/v1/admin/projects/${config.projectId}/qa-stories/${storyId}/runs?limit=${limit ?? 10}`,
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'get_qa_story_run',
    {
      title: titleOf('get_qa_story_run', TDD_TOOL_CATALOG),
      description: descOf('get_qa_story_run', TDD_TOOL_CATALOG),
      annotations: annotationsFor('get_qa_story_run', TDD_TOOL_CATALOG),
      inputSchema: {
        storyId: z.string().describe('QA story id (uuid)'),
        runId: z.string().describe('Run id (uuid) to fetch detail for'),
      },
    },
    async ({ storyId, runId }) => {
      // There is no single-run detail route that accepts an API key (the
      // evidence route is JWT-only), so fetch the recent runs list and select
      // the requested run — the list rows already include summary, assertion
      // failures, error message, and the provider session URL.
      const data = await apiCall<{ data?: { runs?: Array<{ id: string }> } }>(
        `/v1/admin/projects/${config.projectId}/qa-stories/${storyId}/runs?limit=50`,
      )
      const run = data?.data?.runs?.find((r) => r.id === runId) ?? null
      if (!run) {
        throw new MushiApiError(
          404,
          'RUN_NOT_FOUND',
          `Run ${runId} not found in the 50 most recent runs for story ${storyId}`,
        )
      }
      return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] }
    },
  )

  server.registerTool(
    'test_notification_channel',
    {
      title: titleOf('test_notification_channel', TDD_TOOL_CATALOG),
      description: descOf('test_notification_channel', TDD_TOOL_CATALOG),
      annotations: annotationsFor('test_notification_channel', TDD_TOOL_CATALOG),
      inputSchema: {
        kind: z.enum(['slack', 'discord']).describe('Notification channel kind to test'),
      },
    },
    async ({ kind }) => {
      const data = await apiCall<unknown>(
        `/v1/admin/projects/${config.projectId}/integrations/${kind}/test`,
        { method: 'POST' },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  // ── Full-Stack Audit tools (Phase 5) ───────────────────────────────────────

  server.registerTool(
    'run_fullstack_audit',
    {
      title: titleOf('run_fullstack_audit'),
      description: descOf('run_fullstack_audit'),
      annotations: annotationsFor('run_fullstack_audit'),
      inputSchema: {
        project_id: z.string().optional().describe('Project ID to audit. Defaults to the configured project.'),
      },
    },
    async ({ project_id }) => {
      const pid = project_id ?? config.projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT_ID', 'project_id is required')
      const data = await apiCall<unknown>(
        `/v1/admin/projects/${pid}/audit`,
        { method: 'POST', body: '{}' },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.registerTool(
    'get_backend_health',
    {
      title: titleOf('get_backend_health'),
      description: descOf('get_backend_health'),
      annotations: annotationsFor('get_backend_health'),
      inputSchema: {
        project_id: z.string().optional().describe('Project ID. Defaults to the configured project.'),
        include_logs: z.boolean().optional().describe('Whether to include recent backend error logs (default: true).'),
      },
    },
    async ({ project_id, include_logs = true }) => {
      const pid = project_id ?? config.projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT_ID', 'project_id is required')

      const [schemaRes, advisorsRes, logsRes] = await Promise.allSettled([
        apiCall<unknown>(`/v1/admin/projects/${pid}/backend/schema`),
        apiCall<unknown>(`/v1/admin/projects/${pid}/db-advisors`),
        include_logs ? apiCall<unknown>(`/v1/admin/projects/${pid}/backend/logs?service=api`) : Promise.resolve(null),
      ])

      const result = {
        schema: schemaRes.status === 'fulfilled' ? schemaRes.value : { error: String(schemaRes.reason) },
        advisors: advisorsRes.status === 'fulfilled' ? advisorsRes.value : { error: String(advisorsRes.reason) },
        logs: logsRes.status === 'fulfilled' ? logsRes.value : include_logs ? { error: String(logsRes.reason) } : null,
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── Usage / billing MCP tool ─────────────────────────────────────────────
  server.registerTool(
    'get_usage',
    {
      title: titleOf('get_usage'),
      description: descOf('get_usage'),
      annotations: annotationsFor('get_usage'),
      inputSchema: {
        project_id: z.string().optional().describe('Project ID. Defaults to the configured project.'),
      },
    },
    async ({ project_id }) => {
      const pid = project_id ?? config.projectId
      const path = pid ? `/v1/admin/billing/stats?project_id=${pid}` : '/v1/admin/billing/stats'
      const data = await apiCall<{
        planId: string
        diagnosesUsed: number
        diagnosesLimit: number | null
        diagnosesUsagePct: number | null
        overDiagnosisQuota: boolean
        approachingDiagnosisQuota: boolean
        monthlySpendCapUsd: number | null
        periodEnd: string | null
        freeLimitDiagnoses: number
      }>(path)
      return jsonText(data)
    },
  )

  // ── Skill Pipeline MCP tools ──────────────────────────────────────────────
  server.registerTool(
    'list_skills',
    {
      title: titleOf('list_skills'),
      description: descOf('list_skills'),
      annotations: annotationsFor('list_skills'),
      inputSchema: {
        category: z.string().optional().describe('Filter by category: workflow, debug, test, audit, enhance, …'),
        search: z.string().optional().describe('Free-text search across slug, title, description'),
        page: z.number().optional().describe('Page number (default 1)'),
        limit: z.number().optional().describe('Max results per page (default 200, max 200)'),
      },
    },
    async (args) => {
      const qs = new URLSearchParams()
      if (args.category) qs.set('category', args.category)
      if (args.search) qs.set('q', args.search)
      if (args.page) qs.set('page', String(args.page))
      qs.set('limit', String(Math.min(args.limit ?? 200, 200)))
      // apiCall unwraps the `{ ok, data }` envelope, so `data` is the skill array.
      const data = await apiCall<unknown[]>(`/v1/admin/skills?${qs}`)
      const skills = Array.isArray(data) ? data : []
      return jsonText({ skills, count: skills.length })
    },
  )

  server.registerTool(
    'get_skill',
    {
      title: titleOf('get_skill'),
      description: descOf('get_skill'),
      annotations: annotationsFor('get_skill'),
      inputSchema: {
        slug: z.string().describe('Skill slug, e.g. "workflow-fix-and-ship"'),
      },
    },
    async (args) => {
      const data = await apiCall<unknown>(`/v1/admin/skills/${args.slug}`)
      return jsonText(data)
    },
  )

  server.registerTool(
    'start_skill_pipeline',
    {
      title: titleOf('start_skill_pipeline'),
      description: descOf('start_skill_pipeline'),
      annotations: annotationsFor('start_skill_pipeline'),
      inputSchema: {
        root_skill_slug: z.string().describe('Root skill slug to run, e.g. "workflow-fix-and-ship"'),
        report_id: z.string().optional().describe('Report UUID to attach the pipeline to'),
        mode: z.enum(['handoff', 'cloud']).optional().describe('handoff (default): get context packet for local agent. cloud: auto-dispatch via Cursor Cloud.'),
        project_id: z.string().optional().describe('Project UUID. Falls back to the configured project.'),
      },
    },
    async (args) => {
      const resolvedProjectId = args.project_id ?? projectId
      if (!resolvedProjectId) return jsonText({ error: 'No project_id provided or configured.' })
      // apiCall unwraps to the run row (includes id, chain_slugs, context_packet).
      // Spread args first so the resolved project_id always wins.
      const data = await apiCall<Record<string, unknown>>(
        '/v1/admin/skills/pipelines',
        { method: 'POST', body: JSON.stringify({ ...args, project_id: resolvedProjectId }) },
      )
      return jsonText(data)
    },
  )

  server.registerTool(
    'get_pipeline_run',
    {
      title: titleOf('get_pipeline_run'),
      description: descOf('get_pipeline_run'),
      annotations: annotationsFor('get_pipeline_run'),
      inputSchema: {
        run_id: z.string().describe('Pipeline run UUID'),
      },
    },
    async (args) => {
      const data = await apiCall<unknown>(`/v1/admin/skills/pipelines/${args.run_id}`)
      return jsonText(data)
    },
  )

  server.registerTool(
    'checkin_pipeline_step',
    {
      title: titleOf('checkin_pipeline_step'),
      description: descOf('checkin_pipeline_step'),
      annotations: annotationsFor('checkin_pipeline_step'),
      inputSchema: {
        run_id: z.string().describe('Pipeline run UUID'),
        step_index: z.number().describe('Step index (0-based)'),
        status: z.enum(['running', 'passed', 'failed', 'skipped']).describe('Step status'),
        notes: z.string().optional().describe('Optional notes or output summary'),
        pr_url: z.string().optional().describe('PR URL opened during this step'),
        agent_ref: z.string().optional().describe('Cursor agentId or external agent reference'),
      },
    },
    async (args) => {
      const { run_id, step_index, ...body } = args
      await apiCall(
        `/v1/admin/skills/pipelines/${run_id}/steps/${step_index}/checkin`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      return jsonText({ ok: true, message: `Step ${step_index} → ${args.status}` })
    },
  )

  // ── Codebase Understand tools ─────────────────────────────────────────────

  server.registerTool(
    'ask_codebase',
    {
      title: titleOf('ask_codebase', CODEBASE_TOOL_CATALOG),
      description: descOf('ask_codebase', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('ask_codebase', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
        question: z.string().describe('Plain-English question about the repo'),
        thread_id: z.string().optional().describe('Optional thread UUID to continue a conversation'),
        file_path: z.string().optional().describe('Optional file path focus'),
        symbol_name: z.string().optional().describe('Optional symbol name focus'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: args.question }],
      }
      if (args.thread_id) body.threadId = args.thread_id
      if (args.file_path) {
        body.fileFocus = {
          file_path: args.file_path,
          symbol_name: args.symbol_name ?? null,
        }
      }
      const data = await apiCall<unknown>(`/v1/admin/projects/${pid}/codebase/chat`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return jsonText(data)
    },
  )

  server.registerTool(
    'get_file_summary',
    {
      title: titleOf('get_file_summary', CODEBASE_TOOL_CATALOG),
      description: descOf('get_file_summary', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('get_file_summary', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
        file_path: z.string().describe('Indexed file path'),
        symbol_name: z.string().optional().describe('Optional symbol name within the file'),
        force: z.boolean().optional().describe('Bypass cache and regenerate'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const qs = new URLSearchParams({ file_path: args.file_path })
      if (args.symbol_name) qs.set('symbol_name', args.symbol_name)
      if (args.force) qs.set('force', '1')
      const data = await apiCall<unknown>(`/v1/admin/projects/${pid}/codebase/summary?${qs}`)
      return jsonText(data)
    },
  )

  server.registerTool(
    'get_codebase_tour',
    {
      title: titleOf('get_codebase_tour', CODEBASE_TOOL_CATALOG),
      description: descOf('get_codebase_tour', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('get_codebase_tour', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
        force: z.boolean().optional().describe('Bypass cache and regenerate'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const qs = args.force ? '?force=1' : ''
      const data = await apiCall<unknown>(`/v1/admin/projects/${pid}/codebase/tour${qs}`)
      return jsonText(data)
    },
  )

  server.registerTool(
    'search_codebase',
    {
      title: titleOf('search_codebase', CODEBASE_TOOL_CATALOG),
      description: descOf('search_codebase', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('search_codebase', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
        query: z.string().describe('Plain-English search query against indexed source files'),
        k: z.number().int().min(1).max(20).optional().describe('Max hits to return (default 8, max 20)'),
        scope_prefix: z.string().optional().describe('Optional repo subdirectory prefix to limit search scope'),
      },
      outputSchema: {
        results: z.array(z.unknown()).describe('Ranked file/symbol hits with paths, line ranges, and similarity'),
        query: z.string().describe('Normalized query string that was searched'),
        mode: z.string().optional().describe('semantic (embeddings) or name (path/symbol match)'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const data = await apiCall<{ results: unknown[]; query: string; mode?: string }>(
        `/v1/admin/projects/${pid}/codebase/search`,
        {
          method: 'POST',
          body: JSON.stringify({
            query: args.query,
            k: args.k ?? 8,
            scope_prefix: args.scope_prefix ?? undefined,
          }),
        },
      )
      return jsonResult(data)
    },
  )

  server.registerTool(
    'get_codebase_domains',
    {
      title: titleOf('get_codebase_domains', CODEBASE_TOOL_CATALOG),
      description: descOf('get_codebase_domains', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('get_codebase_domains', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
        force: z.boolean().optional().describe('Bypass cache and regenerate'),
        scope_prefix: z.string().optional().describe('Optional subdirectory scope prefix'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const qs = new URLSearchParams()
      if (args.force) qs.set('force', '1')
      if (args.scope_prefix) qs.set('scope_prefix', args.scope_prefix)
      const suffix = qs.toString() ? `?${qs}` : ''
      const data = await apiCall<unknown>(`/v1/admin/projects/${pid}/codebase/domains${suffix}`)
      return jsonText(data)
    },
  )

  server.registerTool(
    'analyze_codebase_impact',
    {
      title: titleOf('analyze_codebase_impact', CODEBASE_TOOL_CATALOG),
      description: descOf('analyze_codebase_impact', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('analyze_codebase_impact', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
        paths: z.array(z.string()).optional().describe('Changed repo-relative file paths to analyze'),
        source: z.enum(['last_push', 'compare', 'fix']).optional().describe('Auto-resolve changed paths instead of manual paths'),
        compare: z.string().optional().describe('GitHub compare range base...head when source=compare'),
        fix_id: z.string().optional().describe('Fix attempt UUID — uses that PR\'s changed files when source=fix'),
      },
      outputSchema: {
        changed_paths: z.array(z.string()).describe('Resolved set of changed paths analyzed'),
        source: z.string().describe('How changed_paths were resolved (manual, last_push, compare, fix, …)'),
        affected_file_paths: z.array(z.string()).describe('Indexed files that import or depend on changed paths'),
        affected_node_ids: z.array(z.string()).describe('Codebase graph node ids impacted by the change'),
        meta: z.unknown().nullable().optional().describe('Extra resolution metadata when auto-sourced'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const qs = new URLSearchParams()
      if (args.paths?.length) qs.set('paths', args.paths.join(','))
      if (args.source === 'last_push') qs.set('ref', 'last_push')
      if (args.compare) qs.set('compare', args.compare)
      if (args.fix_id) qs.set('fix_id', args.fix_id)
      if (!qs.toString()) {
        throw new MushiApiError(400, 'BAD_REQUEST', 'Provide paths, source=last_push, compare, or fix_id')
      }
      const data = await apiCall<{
        changed_paths: string[]
        source: string
        affected_file_paths: string[]
        affected_node_ids: string[]
        meta?: unknown | null
      }>(`/v1/admin/projects/${pid}/codebase/impact?${qs}`)
      return jsonResult(data)
    },
  )

  server.registerTool(
    'analyze_wiki_knowledge',
    {
      title: titleOf('analyze_wiki_knowledge', CODEBASE_TOOL_CATALOG),
      description: descOf('analyze_wiki_knowledge', CODEBASE_TOOL_CATALOG),
      annotations: annotationsFor('analyze_wiki_knowledge', CODEBASE_TOOL_CATALOG),
      inputSchema: {
        project_id: z.string().optional().describe('Project UUID (defaults to configured project)'),
      },
    },
    async (args) => {
      const pid = args.project_id ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'project_id is required')
      const data = await apiCall<unknown>(`/v1/admin/projects/${pid}/codebase/knowledge/graph`)
      return jsonText(data)
    },
  )

  // ── use_mushi meta-tool ────────────────────────────────────────────────────
  // Single entry point for orientation and context-cost reduction.
  // Returns a curated tool list for the agent's stated intent so it can skip
  // loading all 68 tool descriptions up-front (mirrors Sentry's `use_sentry`).
  server.registerTool(
    'use_mushi',
    {
      title: titleOf('use_mushi'),
      description: descOf('use_mushi'),
      inputSchema: {
        intent: z.string().optional().describe(
          'What you are trying to accomplish with Mushi, e.g. "fix the top bug", ' +
          '"check project health", "run QA tests", "set up Mushi". ' +
          'Leave blank for a general orientation.',
        ),
      },
      annotations: annotationsFor('use_mushi'),
    },
    async (args) => {
      const intent = (args.intent ?? '').toLowerCase()

      // Match intent to curated tool subset.
      let matched = Object.entries(USE_MUSHI_INTENTS).find(([key]) => intent.includes(key))
      // If no keyword match, default to "status" orientation.
      if (!matched) matched = ['status', USE_MUSHI_INTENTS['status']!]

      const [, cluster] = matched

      // Build project-aware orientation line.
      const projectLine = projectId
        ? `Connected project: \`${projectId}\`. `
        : 'No project configured — run `mushi_setup` or set MUSHI_PROJECT_ID. '

      const orientation = [
        `## Mushi — ${cluster.label}`,
        '',
        projectLine + cluster.hint,
        '',
        '### Recommended tools for this intent',
        cluster.tools.map((t) => `- \`${t}\``).join('\n'),
        '',
        '### First step',
        `Call \`${cluster.tools[0]}\` to get started.`,
        '',
        '> Tip: call any tool by name — \`use_mushi\` is a read-only helper that ' +
          'never calls other tools itself. All 68 tools remain available.',
      ].join('\n')

      return { content: [{ type: 'text', text: orientation }] }
    },
  )

  // Apply scope filtering if granted scopes were provided.
  // All tools are registered above for readability; this block removes the
  // ones the caller's API key does not have access to. When `scopes` is
  // undefined (default), every tool stays registered. When `scopes` is an
  // empty array, every tool is removed — the SDK then omits the `tools`
  // capability from the MCP handshake entirely.
  const grantedScopes = config.scopes
  const featureFilter = config.features ?? 'all'
  if (grantedScopes !== undefined || featureFilter !== 'all') {
    // Access the internal registry via a known-private field. This is
    // intentional: the SDK exposes no public "remove by name" method and
    // we need post-registration filtering to keep the registration code
    // readable. Cast once, filter, done.
    type ToolRegistry = Record<string, { remove(): void }>
    const toolRegistry = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools
    const allSpecs = [
      ...TOOL_CATALOG,
      ...TDD_TOOL_CATALOG,
      ...CODEBASE_TOOL_CATALOG,
    ]
    for (const spec of allSpecs) {
      if (grantedScopes !== undefined && !(grantedScopes as readonly string[]).includes(spec.scope)) {
        toolRegistry[spec.name]?.remove()
      }
      if (featureFilter !== 'all' && !toolMatchesFeatures(spec.name, featureFilter)) {
        toolRegistry[spec.name]?.remove()
      }
    }
  }

  // ── One-time mcp_first_tool_call funnel signal ─────────────────────────────
  // On the very first successful tool invocation for a project, emit a
  // fire-and-forget funnel event so operators can see the MCP → first AI query
  // conversion rate in the onboarding panel. The signal is deduplicated
  // server-side (UNIQUE dedup_key), so re-connecting the MCP server never
  // double-counts. We use a module-level flag to avoid redundant HTTP calls
  // within a single process lifetime.
  // Capture the native fetch at server-creation time so funnel pings are
  // transparent to test stubs that replace the injected `doFetch`.
  const _nativeFetch: typeof globalThis.fetch = globalThis.fetch
  let _firstToolCallSignalled = false
  const _signalFirstToolCall = (): void => {
    if (_firstToolCallSignalled || !projectId) return
    _firstToolCallSignalled = true
    void _nativeFetch(`${apiEndpoint}/v1/cli/funnel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': apiKey,
        'X-Mushi-Project': projectId,
      },
      body: JSON.stringify({ event: 'mcp_first_tool_call' }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => { /* best-effort — never block a tool call */ })
  }

  // Intercept the first successful tool call via the low-level request handler map.
  // McpServer stores its CallToolRequest handler in `server.server._requestHandlers`
  // (a Map<method, handler>). We read the installed handler and replace it with a thin
  // wrapper that calls the original then fires the one-time funnel signal.
  // Using _requestHandlers directly avoids re-triggering McpServer's validation wrapper
  // (which would cause double-validation) while remaining type-safe via the cast below.
  type LowLevelServer = { _requestHandlers: Map<string, (...a: unknown[]) => unknown> }
  const llServer = (server as unknown as { server: LowLevelServer }).server
  const existingToolsCallHandler = llServer?._requestHandlers?.get('tools/call')
  if (typeof existingToolsCallHandler === 'function') {
    llServer._requestHandlers.set('tools/call', async (...args: unknown[]) => {
      const result = await existingToolsCallHandler(...args)
      _signalFirstToolCall()
      return result
    })
  }

  // ── Deprecated-alias backward-compatibility shims ───────────────────────
  // The changeset renamed six tools and removed/consolidated five others.
  // These shims keep old tool names CALLABLE for one release so existing agent
  // configs don't silently break on upgrade, while remaining HIDDEN from
  // tools/list so discovery-aware agents see only the new canonical names.
  //
  // Implementation: we wrap the low-level `tools/call` handler (already
  // accessed above for the funnel signal) a second time. When an incoming call
  // names a deprecated alias, we rewrite the name to the current canonical
  // tool name before passing the request through to the SDK's registered
  // handler. No new tool registrations → tools/list is unaffected.
  {
    type LowLevelServer = { _requestHandlers: Map<string, (...a: unknown[]) => unknown> }
    const llAliasServer = (server as unknown as { server: LowLevelServer }).server
    const innerHandler = llAliasServer?._requestHandlers?.get('tools/call')
    if (typeof innerHandler === 'function') {
      llAliasServer._requestHandlers.set('tools/call', async (...args: unknown[]) => {
        // args[0] is the JSON-RPC request object passed by the SDK transport.
        const req = args[0] as { params?: { name?: string; arguments?: unknown } } | undefined
        const originalName = req?.params?.name
        const canonicalName = originalName ? DEPRECATED_TOOL_ALIASES[originalName] : undefined
        if (canonicalName) {
          // Rewrite name in-place (same object reference is fine — the SDK
          // only reads params once). Restore after the call to avoid aliasing
          // surprises in case the SDK re-uses the request object.
          const rewritten = {
            ...(args[0] as Record<string, unknown>),
            params: { ...(req?.params ?? {}), name: canonicalName },
          }
          const result = await innerHandler(rewritten, ...args.slice(1))
          // Inject a deprecation notice into the text content so callers see it.
          if (
            result != null &&
            typeof result === 'object' &&
            'content' in result &&
            Array.isArray((result as { content: unknown[] }).content)
          ) {
            const r = result as { content: unknown[]; [k: string]: unknown }
            return {
              ...r,
              content: [
                {
                  type: 'text',
                  text:
                    `⚠️ Deprecated: \`${originalName}\` was renamed to \`${canonicalName}\`. ` +
                    `Update your agent config — this alias will be removed in the next release.`,
                },
                ...r.content,
              ],
            }
          }
          return result
        }
        return innerHandler(...args)
      })
    }
  }

  return server
}
