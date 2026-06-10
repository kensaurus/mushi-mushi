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
import { TOOL_CATALOG, TDD_TOOL_CATALOG, type McpScope } from './catalog.js'

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
}

/**
 * Build an MCP server instance pre-wired with every Mushi tool, resource,
 * and prompt. Does NOT call `server.connect()` — the caller binds whatever
 * transport they need (stdio for the CLI, InMemoryTransport for tests).
 */
export function createMushiServer(config: MushiServerConfig): McpServer {
  const { version, apiEndpoint, apiKey, projectId } = config
  const doFetch = config.fetch ?? globalThis.fetch

  // Short-circuit for empty scope list: return a bare server with no tools
  // capability. The MCP SDK only advertises `tools` when at least one tool
  // has been registered; returning before any registerTool call means the
  // client sees no `tools` capability and `tools/list` returns -32601.
  if (config.scopes !== undefined && config.scopes.length === 0) {
    return new McpServer({ name: 'mushi-mushi', version })
  }

  async function apiCall<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    const res = await doFetch(`${apiEndpoint}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // Authorization is accepted by `adminOrApiKey` only as a JWT, but we
        // still send it for endpoints still behind plain `jwtAuth` (legacy)
        // and for transparent proxies that strip X-Mushi-* headers.
        'Authorization': `Bearer ${apiKey}`,
        'X-Mushi-Api-Key': apiKey,
        ...(projectId ? { 'X-Mushi-Project': projectId } : {}),
        ...(options?.headers ?? {}),
      },
    })

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
      throw new MushiApiError(res.status, code, message)
    }

    const envelope = body as ApiEnvelope<T>
    if (envelope && typeof envelope === 'object' && 'ok' in envelope) {
      if (!envelope.ok) {
        const code = envelope.error?.code ?? 'API_ERROR'
        const message = envelope.error?.message ?? 'API returned ok=false'
        throw new MushiApiError(res.status, code, message)
      }
      return (envelope.data ?? ({} as T)) as T
    }

    return body as T
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

  const server = new McpServer({
    name: 'mushi-mushi',
    version,
  })

  /**
   * Pull the catalog entry for a tool and project its hints into the
   * `annotations` shape `registerTool` expects. Centralising this here means
   * we never forget to translate `readOnly` → `readOnlyHint` for a new tool.
   */
  const ALL_TOOL_CATALOG = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG]

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
      const data = await apiCall<{ reports: unknown[]; total: number }>(`/v1/admin/reports?${params}`)
      return jsonResult(data)
    },
  )

  server.registerTool(
    'get_report_detail',
    {
      title: titleOf('get_report_detail'),
      description: descOf('get_report_detail'),
      annotations: annotationsFor('get_report_detail'),
      inputSchema: { reportId: z.string().describe('The report UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/reports/${args.reportId}`)),
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
      return jsonResult(data)
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
      return jsonText(data)
    },
  )

  server.registerTool(
    'get_fix_context',
    {
      title: titleOf('get_fix_context'),
      description: descOf('get_fix_context'),
      annotations: annotationsFor('get_fix_context'),
      inputSchema: { reportId: z.string().describe('The report UUID to fix') },
    },
    async (args) => {
      const report = await apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.reportId}`)
      return jsonText({
        report,
        reproductionSteps: report.reproduction_steps ?? [],
        component: report.component,
        rootCause: (report.stage2_analysis as Record<string, unknown> | undefined)?.rootCause,
        bugOntologyTags: report.bug_ontology_tags,
      })
    },
  )

  server.registerTool(
    'get_fix_timeline',
    {
      title: titleOf('get_fix_timeline'),
      description: descOf('get_fix_timeline'),
      annotations: annotationsFor('get_fix_timeline'),
      inputSchema: { fixId: z.string().describe('fix_attempt UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/fixes/${args.fixId}/timeline`)),
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
        seed: z.string().describe('Starting node id or label'),
        depth: z.number().optional().describe('Traversal depth (default 2, max 4)'),
      },
    },
    async (args) => {
      const params = new URLSearchParams({
        seed: args.seed,
        depth: String(Math.min(args.depth ?? 2, 4)),
      })
      return jsonText(await apiCall(`/v1/admin/graph/traverse?${params}`))
    },
  )

  server.registerTool(
    'graph_neighborhood',
    {
      title: titleOf('graph_neighborhood'),
      description: descOf('graph_neighborhood'),
      annotations: annotationsFor('graph_neighborhood'),
      inputSchema: {
        seed: z.string().describe('Starting node id or label'),
        depth: z.number().optional().describe('Traversal depth (default 2, max 4)'),
      },
    },
    async (args) => {
      const params = new URLSearchParams({
        seed: args.seed,
        depth: String(Math.min(args.depth ?? 2, 4)),
      })
      return jsonText(await apiCall(`/v1/admin/graph/traverse?${params}`))
    },
  )

  server.registerTool(
    'graph_node_status',
    {
      title: titleOf('graph_node_status'),
      description: descOf('graph_node_status'),
      annotations: annotationsFor('graph_node_status'),
      inputSchema: { nodeId: z.string().describe('graph_nodes.id') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/graph/node/${args.nodeId}`)),
  )

  server.registerTool(
    'inventory_get',
    {
      title: titleOf('inventory_get'),
      description: descOf('inventory_get'),
      annotations: annotationsFor('inventory_get'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to the server-configured project when omitted'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for inventory_get')
      return jsonText(await apiCall(`/v1/admin/inventory/${pid}`))
    },
  )

  server.registerTool(
    'inventory_diff',
    {
      title: titleOf('inventory_diff'),
      description: descOf('inventory_diff'),
      annotations: annotationsFor('inventory_diff'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to configured project'),
        fromSha: z.string().describe('Older commit SHA (baseline)'),
        toSha: z.string().describe('Newer commit SHA (candidate)'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for inventory_diff')
      const q = new URLSearchParams({ from: args.fromSha, to: args.toSha })
      return jsonText(await apiCall(`/v1/admin/inventory/${pid}/diff?${q}`))
    },
  )

  server.registerTool(
    'inventory_findings',
    {
      title: titleOf('inventory_findings'),
      description: descOf('inventory_findings'),
      annotations: annotationsFor('inventory_findings'),
      inputSchema: {
        projectId: z.string().optional().describe('Project UUID — defaults to configured project'),
        gate: z.string().optional().describe('Filter by gate id (e.g. dead_handler, status_claim)'),
        severity: z.string().optional().describe('Filter findings by severity'),
      },
    },
    async (args) => {
      const pid = args.projectId ?? projectId
      if (!pid) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required for inventory_findings')
      const q = new URLSearchParams()
      if (args.gate) q.set('gate', args.gate)
      if (args.severity) q.set('severity', args.severity)
      const suffix = q.toString() ? `?${q}` : ''
      return jsonText(await apiCall(`/v1/admin/inventory/${pid}/findings${suffix}`))
    },
  )

  server.registerTool(
    'fix_suggest',
    {
      title: titleOf('fix_suggest'),
      description: descOf('fix_suggest'),
      annotations: annotationsFor('fix_suggest'),
      inputSchema: { reportId: z.string().describe('Report UUID') },
    },
    async (args) => {
      const report = await apiCall<Record<string, unknown>>(`/v1/admin/reports/${args.reportId}`)
      const s2 = report.stage2_analysis as Record<string, unknown> | null | undefined
      return jsonText({
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
      return jsonText(data)
    },
  )

  // --- Setup / admin tools -----------------------------------------------

  server.registerTool(
    'setup_check',
    {
      title: titleOf('setup_check'),
      description: descOf('setup_check'),
      annotations: annotationsFor('setup_check'),
      inputSchema: {
        projectId: z.string().optional().describe(
          'Project UUID to check. Falls back to the projectId the server was initialised with.',
        ),
      },
    },
    async (args) => {
      const resolvedId = args.projectId ?? projectId
      if (!resolvedId) {
        return jsonText({
          ok: false,
          error: 'No projectId provided and none configured on the MCP server. Pass projectId explicitly.',
        })
      }
      const data = await apiCall<{
        ready: boolean
        checks: Array<{ key: string; ready: boolean; label: string; hint: string; fixHref: string }>
        repoUrl: string | null
      }>(`/v1/admin/projects/${resolvedId}/preflight`)

      const summary = data.checks.map((c) => ({
        check: c.key,
        label: c.label,
        passed: c.ready,
        hint: c.hint,
        fixPath: c.fixHref,
      }))

      return jsonText({
        ready: data.ready,
        repoUrl: data.repoUrl ?? null,
        checks: summary,
        // Human-readable summary for agents that paste the result into a prompt
        summary: data.ready
          ? `Project ${resolvedId} is ready to dispatch auto-fixes${data.repoUrl ? ` (target: ${data.repoUrl})` : ''}.`
          : `Project ${resolvedId} cannot dispatch yet — ${summary.filter((c) => !c.passed).map((c) => c.label).join(', ')}.`,
      })
    },
  )

  server.registerTool(
    'ingest_setup_check',
    {
      title: titleOf('ingest_setup_check'),
      description: descOf('ingest_setup_check'),
      annotations: annotationsFor('ingest_setup_check'),
      inputSchema: {},
    },
    async () => {
      const data = await apiCall<{
        ready: boolean
        required_complete: number
        required_total: number
        project_id: string
        project_name: string
        steps: Array<{ id: string; label: string; complete: boolean; required: boolean; hint: string }>
        diagnostic?: {
          last_sdk_seen_at: string | null
          last_sdk_endpoint_host: string | null
          admin_endpoint_host: string | null
        }
      }>('/v1/sync/ingest-setup')

      const failed = data.steps.filter((s) => s.required && !s.complete)
      const summary = data.ready
        ? `Ingest setup complete (${data.required_complete}/${data.required_total}) for ${data.project_name}.`
        : `Ingest incomplete (${data.required_complete}/${data.required_total}) — still need: ${failed.map((s) => s.label).join(', ')}.`

      return jsonText({
        ready: data.ready,
        projectId: data.project_id,
        projectName: data.project_name,
        requiredComplete: data.required_complete,
        requiredTotal: data.required_total,
        steps: data.steps.map((s) => ({
          id: s.id,
          label: s.label,
          passed: s.complete,
          required: s.required,
          hint: s.hint,
        })),
        diagnostic: data.diagnostic ?? null,
        summary,
      })
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
        reportId: z.string().describe('The report UUID'),
        branch: z.string().describe('Git branch name'),
        prUrl: z.string().optional().describe('GitHub PR URL'),
        filesChanged: z.array(z.string()).describe('Files modified'),
        linesChanged: z.number().describe('Total lines changed'),
        summary: z.string().describe('Fix summary'),
      },
    },
    async (args) => {
      const created = await apiCall<{ fixId: string }>('/v1/admin/fixes', {
        method: 'POST',
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
      return jsonText({ ok: true, fixId: created.fixId })
    },
  )

  server.registerTool(
    'dispatch_fix',
    {
      title: titleOf('dispatch_fix'),
      description: descOf('dispatch_fix'),
      annotations: annotationsFor('dispatch_fix'),
      inputSchema: {
        reportId: z.string().describe('Report UUID to fix'),
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
    },
    async (args) => {
      const data = await apiCall('/v1/admin/judge/run', {
        method: 'POST',
        body: JSON.stringify({
          limit: Math.min(args.limit ?? 25, 100),
          projectId: args.projectId ?? projectId ?? undefined,
        }),
      })
      return jsonText(data)
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
    'transition_status',
    {
      title: titleOf('transition_status'),
      description: descOf('transition_status'),
      annotations: annotationsFor('transition_status'),
      inputSchema: {
        reportId: z.string().describe('Report UUID'),
        status: z.enum(['pending', 'classified', 'grouped', 'fixing', 'fixed', 'dismissed']).describe('Target status'),
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

  // --- Resources -------------------------------------------------------

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

  const rewardsMeta = (name: string) => annotationsFor(name)

  server.tool(
    'list_top_contributors',
    rewardsMeta('list_top_contributors').title,
    {
      limit: z.number().int().min(1).max(100).optional().default(10).describe('Max rows to return (default 10, max 100)'),
      range: z.enum(['30d', '90d', 'all']).optional().default('30d').describe('Time window for points calculation'),
    },
    rewardsMeta('list_top_contributors'),
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

  server.tool(
    'award_bonus_points',
    rewardsMeta('award_bonus_points').title,
    {
      external_user_id: z.string().describe('The host-app user id as passed to Mushi.identify()'),
      points: z.number().int().min(1).max(50000).describe('Bonus points to award (max 50,000 per call)'),
      reason: z.string().max(200).describe('Human-readable reason, logged to end_user_activity'),
    },
    rewardsMeta('award_bonus_points'),
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

  server.tool(
    'set_tier',
    rewardsMeta('set_tier').title,
    {
      external_user_id: z.string().describe('The host-app user id as passed to Mushi.identify()'),
      tier_slug: z.string().describe('Tier slug to assign, e.g. "champion", "contributor", "explorer"'),
      reason: z.string().max(200).optional().describe('Optional reason for manual override'),
    },
    rewardsMeta('set_tier'),
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
        text: JSON.stringify(await apiCall('/v1/admin/privacy/status'), null, 2),
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
        text: JSON.stringify(await apiCall('/v1/admin/evolution/history'), null, 2),
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
        projectId: z.string().describe('Project id'),
        storyNodeId: z.string().describe('User story id slug from the accepted inventory'),
        automationMode: z.enum(['auto', 'review', 'approve']).optional().describe('Gate mode for the generated test (default: review)'),
        baseUrl: z.string().url().optional().describe('Override the app base URL'),
        openPr: z.boolean().optional().describe('Open a draft GitHub PR (default: true)'),
      },
    },
    async ({ projectId, storyNodeId, automationMode, baseUrl, openPr }) => {
      if (!projectId) throw new MushiApiError(400, 'MISSING_PROJECT', 'projectId is required')
      const data = await apiCall<unknown>(
        `/v1/admin/inventory/${projectId}/stories/${storyNodeId}/generate-test`,
        { method: 'POST', body: JSON.stringify({ automation_mode: automationMode, base_url: baseUrl, open_pr: openPr }) },
      )
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
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

  // Apply scope filtering if granted scopes were provided.
  // All tools are registered above for readability; this block removes the
  // ones the caller's API key does not have access to. When `scopes` is
  // undefined (default), every tool stays registered. When `scopes` is an
  // empty array, every tool is removed — the SDK then omits the `tools`
  // capability from the MCP handshake entirely.
  const grantedScopes = config.scopes
  if (grantedScopes !== undefined) {
    // Access the internal registry via a known-private field. This is
    // intentional: the SDK exposes no public "remove by name" method and
    // we need post-registration filtering to keep the registration code
    // readable. Cast once, filter, done.
    type ToolRegistry = Record<string, { remove(): void }>
    const toolRegistry = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools
    const allSpecs = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG]
    for (const spec of allSpecs) {
      if (!(grantedScopes as readonly string[]).includes(spec.scope)) {
        toolRegistry[spec.name]?.remove()
      }
    }
  }

  return server
}
