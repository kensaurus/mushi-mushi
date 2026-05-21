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
import { ALL_SCOPES, TOOL_CATALOG, type McpScope } from './catalog.js'

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
   * Granted scopes for this connection. When provided, `tools/list` and the
   * resource catalog only expose tools whose `scope` is included. Defaults
   * to ALL_SCOPES (`['mcp:read', 'mcp:write']`) so existing API-key callers
   * keep seeing every tool. Set to `['mcp:read']` for a read-only key so
   * the LLM never sees `dispatch_fix` / `transition_status` / `set_tier`
   * in its tool list — preventing the "tool exists, call returns 403" loop
   * that wastes tokens and confuses agents.
   *
   * Mirrors the per-tool scope-filtering pattern used by getsentry/sentry-mcp
   * (see `permissions.ts` in that repo).
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
  // Per-scope tool filtering: default to all scopes so existing callers
  // (every API key issued before this flag was added) keep their full
  // toolset. Read-only API keys passing scopes=['mcp:read'] will get a
  // tools/list response that omits write tools entirely.
  const grantedScopes: ReadonlySet<McpScope> = new Set(config.scopes ?? ALL_SCOPES)

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

  const server = new McpServer({
    name: 'mushi-mushi',
    version,
  })

  /**
   * Pull the catalog entry for a tool and project its hints into the
   * `annotations` shape `registerTool` expects. Centralising this here means
   * we never forget to translate `readOnly` → `readOnlyHint` for a new tool.
   */
  function annotationsFor(name: string): Record<string, unknown> {
    const spec = TOOL_CATALOG.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    const a: Record<string, unknown> = {
      title: spec.title,
      readOnlyHint: spec.hints.readOnly,
    }
    if (spec.hints.destructive !== undefined) a.destructiveHint = spec.hints.destructive
    if (spec.hints.idempotent !== undefined) a.idempotentHint = spec.hints.idempotent
    if (spec.hints.openWorld !== undefined) a.openWorldHint = spec.hints.openWorld
    return a
  }

  function descOf(name: string): string {
    const spec = TOOL_CATALOG.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    return spec.description
  }

  function titleOf(name: string): string {
    const spec = TOOL_CATALOG.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    return spec.title
  }

  /**
   * Resolve the catalog scope for a tool name and gate registration. Returns
   * `true` when the tool should be registered for the current connection.
   * Throws on unknown names so adding a tool without a catalog entry fails
   * fast — the existing helpers do the same.
   */
  function shouldRegister(name: string): boolean {
    const spec = TOOL_CATALOG.find((t) => t.name === name)
    if (!spec) throw new Error(`[mushi-mcp] tool "${name}" is missing from TOOL_CATALOG`)
    return grantedScopes.has(spec.scope)
  }

  /**
   * Format any value as both an MCP text block AND a `structuredContent`
   * object. The text block is what older clients see; modern clients
   * (Claude Desktop, Cursor 0.54+) read `structuredContent` directly and
   * pipe it into typed downstream tools. When an `outputSchema` is defined
   * on `registerTool`, the SDK validates `structuredContent` against it
   * before sending — so a regression in API shape produces a typed error
   * the LLM can branch on, not a silent JSON drift.
   */
  function jsonResult<T extends Record<string, unknown>>(value: T) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
    }
  }

  /**
   * Scope-gated wrapper around `server.registerTool`. Looks up the tool's
   * required scope in `TOOL_CATALOG`; if the connection doesn't have it,
   * registration is skipped entirely so the tool never appears in
   * `tools/list`. Mirrors Sentry MCP's per-call scope check pattern but
   * filters at registration time rather than at call time — cheaper and
   * more honest, since the LLM can't see-then-fail-on a forbidden tool.
   *
   * The cast preserves the SDK's overload resolution at every call site
   * (so `args` inside each handler keeps its Zod-inferred type) while
   * still letting us skip registration when the scope check fails.
   */
  /* eslint-disable @typescript-eslint/no-explicit-any -- forwarding through SDK overloads */
  const _serverRegisterTool = server.registerTool.bind(server) as any
  const registerScopedTool: McpServer['registerTool'] = ((name: string, ...rest: any[]) => {
    if (!shouldRegister(name)) return undefined as never
    return _serverRegisterTool(name, ...rest)
  }) as McpServer['registerTool']
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // --- Read tools -------------------------------------------------------
  // All tool metadata (description, title, readOnly/destructive hints) comes
  // from `TOOL_CATALOG` so the admin /mcp page and the MCP handshake can't
  // drift. Adding a tool = add a catalog entry + a registerTool call.

  registerScopedTool(
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
      // Output schema (MCP 2025-06-18): when set, the SDK validates the
      // tool's `structuredContent` and lets typed clients deserialize
      // without re-parsing the text payload.
      outputSchema: {
        reports: z.array(z.record(z.string(), z.unknown())).describe('Array of report rows'),
        total: z.number().describe('Total matching rows (before limit)'),
      },
    },
    async (args) => {
      const params = new URLSearchParams()
      if (args.status) params.set('status', args.status)
      if (args.category) params.set('category', args.category)
      if (args.severity) params.set('severity', args.severity)
      params.set('limit', String(Math.min(args.limit ?? 20, 100)))
      const data = await apiCall<{ reports: unknown[]; total: number }>(`/v1/admin/reports?${params}`)
      return jsonResult({
        reports: (data.reports ?? []) as Record<string, unknown>[],
        total: data.total ?? 0,
      })
    },
  )

  registerScopedTool(
    'get_report_detail',
    {
      title: titleOf('get_report_detail'),
      description: descOf('get_report_detail'),
      annotations: annotationsFor('get_report_detail'),
      inputSchema: { reportId: z.string().describe('The report UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/reports/${args.reportId}`)),
  )

  registerScopedTool(
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
        results: z.array(z.record(z.string(), z.unknown())).describe('Ranked report rows with similarity scores'),
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
      return jsonResult({ results: (data.results ?? []) as Record<string, unknown>[] })
    },
  )

  registerScopedTool(
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
        results: z.array(z.record(z.string(), z.unknown())).describe('Ranked report rows with similarity scores'),
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
      return jsonResult({ results: (data.results ?? []) as Record<string, unknown>[] })
    },
  )

  registerScopedTool(
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

  registerScopedTool(
    'get_fix_timeline',
    {
      title: titleOf('get_fix_timeline'),
      description: descOf('get_fix_timeline'),
      annotations: annotationsFor('get_fix_timeline'),
      inputSchema: { fixId: z.string().describe('fix_attempt UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/fixes/${args.fixId}/timeline`)),
  )

  registerScopedTool(
    'get_blast_radius',
    {
      title: titleOf('get_blast_radius'),
      description: descOf('get_blast_radius'),
      annotations: annotationsFor('get_blast_radius'),
      inputSchema: { nodeId: z.string().describe('Graph node UUID') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/graph/blast-radius/${args.nodeId}`)),
  )

  registerScopedTool(
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

  registerScopedTool(
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

  registerScopedTool(
    'graph_node_status',
    {
      title: titleOf('graph_node_status'),
      description: descOf('graph_node_status'),
      annotations: annotationsFor('graph_node_status'),
      inputSchema: { nodeId: z.string().describe('graph_nodes.id') },
    },
    async (args) => jsonText(await apiCall(`/v1/admin/graph/node/${args.nodeId}`)),
  )

  registerScopedTool(
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

  registerScopedTool(
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

  registerScopedTool(
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

  registerScopedTool(
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

  registerScopedTool(
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

  // --- Write / agentic tools -------------------------------------------

  registerScopedTool(
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

  registerScopedTool(
    'dispatch_fix',
    {
      title: titleOf('dispatch_fix'),
      description: descOf('dispatch_fix'),
      annotations: annotationsFor('dispatch_fix'),
      inputSchema: {
        reportId: z.string().describe('Report UUID to fix'),
        agent: z.enum(['claude_code', 'codex', 'rest_worker', 'mcp', 'cursor_cloud']).optional()
          .describe('Override the agent adapter. Use "cursor_cloud" to dispatch a Cursor Cloud Agent that opens a signed draft PR.'),
        backend: z.enum(['default', 'claude_code', 'cursor_cloud', 'mcp']).optional()
          .describe('Alias for agent — prefer agent. When both are set, agent wins.'),
        cursorModel: z.string().optional()
          .describe('Optional model override when agent=cursor_cloud (e.g. "composer-latest").'),
        idempotencyKey: z.string().uuid().optional().describe('Optional RFC 4122 UUID. Resend the same key to safely retry without dispatching a duplicate fix job (Idempotency-Key IETF draft).'),
        inventoryActionNodeId: z.string().uuid().optional().describe('Optional inventory Action node UUID for spec-traceability (§2.10). When provided, the fix-worker embeds the expected_outcome contract in the LLM prompt and runs validateAgainstSpec before opening the PR.'),
      },
      // Typed write-tool result. fixId is the cursor for get_fix_timeline so
      // downstream tools can chain without re-parsing the text payload.
      outputSchema: {
        fixId: z.string().describe('Newly created fix_attempt UUID'),
        status: z.string().optional().describe('Initial status (queued, running, delegated, …)'),
        agentId: z.string().optional().describe('Cursor agent ID (bc-…) when agent=cursor_cloud'),
        runId: z.string().optional().describe('Cursor run ID when agent=cursor_cloud'),
        prUrl: z.string().optional().describe('Draft PR URL when agent=cursor_cloud and auto_create_pr=true'),
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

      // Resolve agent: explicit `agent` wins over the legacy `backend` alias.
      const resolvedAgent = args.agent ?? (args.backend !== 'default' ? args.backend : undefined)

      const data = await apiCall<{ fixId?: string; status?: string; agentId?: string; runId?: string; prUrl?: string }>(
        '/v1/admin/fixes/dispatch',
        {
          method: 'POST',
          headers: args.idempotencyKey
            ? { 'Idempotency-Key': args.idempotencyKey }
            : undefined,
          body: JSON.stringify({
            reportId: args.reportId,
            agent: resolvedAgent,
            inventoryActionNodeId: args.inventoryActionNodeId,
            ...(args.cursorModel ? { cursorModel: args.cursorModel } : {}),
            ...(projectId ? { projectId } : {}),
          }),
        },
      )
      return jsonResult({
        fixId: data.fixId ?? '',
        ...(data.status ? { status: data.status } : {}),
        ...(data.agentId ? { agentId: data.agentId } : {}),
        ...(data.runId ? { runId: data.runId } : {}),
        ...(data.prUrl ? { prUrl: data.prUrl } : {}),
      })
    },
  )

  registerScopedTool(
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

  registerScopedTool(
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

  registerScopedTool(
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

  registerScopedTool(
    'list_top_contributors',
    {
      title: titleOf('list_top_contributors'),
      description: descOf('list_top_contributors'),
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(10).describe('Max rows to return (default 10, max 100)'),
        range: z.enum(['30d', '90d', 'all']).optional().default('30d').describe('Time window for points calculation'),
      },
      annotations: annotationsFor('list_top_contributors'),
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

  registerScopedTool(
    'award_bonus_points',
    {
      title: titleOf('award_bonus_points'),
      description: descOf('award_bonus_points'),
      inputSchema: {
        external_user_id: z.string().describe('The host-app user id as passed to Mushi.identify()'),
        points: z.number().int().min(1).max(50000).describe('Bonus points to award (max 50,000 per call)'),
        reason: z.string().max(200).describe('Human-readable reason, logged to end_user_activity'),
      },
      annotations: annotationsFor('award_bonus_points'),
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

  registerScopedTool(
    'set_tier',
    {
      title: titleOf('set_tier'),
      description: descOf('set_tier'),
      inputSchema: {
        external_user_id: z.string().describe('The host-app user id as passed to Mushi.identify()'),
        tier_slug: z.string().describe('Tier slug to assign, e.g. "champion", "contributor", "explorer"'),
        reason: z.string().max(200).optional().describe('Optional reason for manual override'),
      },
      annotations: annotationsFor('set_tier'),
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

  // privacy://status — exposes the project's privacy posture so agents can
  // inspect what happens to client data before dispatching a fix.
  server.resource(
    'privacy_status',
    'privacy://status',
    {
      description:
        'Returns the privacy posture for this project: storage region, LLM provider, whether BYOK is configured, ' +
        'data retention window, and last audit timestamp. Read this before dispatching a fix to confirm ' +
        'that client data stays within the expected boundary.',
    },
    async () => {
      const path = projectId
        ? `/v1/admin/projects/${projectId}/privacy-status`
        : '/v1/admin/privacy-status'
      let data: unknown
      try {
        data = await apiCall(path)
      } catch {
        // Graceful fallback: return a static posture skeleton when the endpoint
        // doesn't exist yet (newly-deployed stacks, self-hosted instances
        // missing the route). Agents can still inspect the structure.
        data = {
          region: null,
          storage_provider: 'supabase',
          llm_provider: 'platform',
          byok_configured: false,
          retention_days: 30,
          last_audit_at: null,
          _note: 'Live data unavailable — update Mushi server to get real values.',
        }
      }
      return {
        contents: [{
          uri: 'privacy://status',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      }
    },
  )

  // evolution://history — 30-day loop convergence data: judge scores,
  // prompt promotions, fixed bugs, and lesson inductions.
  server.resource(
    'evolution_history',
    'evolution://history',
    {
      description:
        'Returns the project\'s last 30 days of judge scores, prompt promotions, fixed-bug count, ' +
        'and lesson inductions. Use to see whether the loop is converging.',
    },
    async () => {
      const path = projectId
        ? `/v1/admin/projects/${projectId}/evolution-history`
        : '/v1/admin/evolution-history'
      let data: unknown
      try {
        data = await apiCall(path)
      } catch {
        data = {
          days: 30,
          fixed_bugs: null,
          avg_judge_score: null,
          prompt_promotions: null,
          lesson_inductions: null,
          weekly_scores: [],
          _note: 'Live data unavailable — update Mushi server to get real values.',
        }
      }
      return {
        contents: [{
          uri: 'evolution://history',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      }
    },
  )

  // setup_repo_for_mushi — writes bootstrap files into the agent's repo
  if (shouldRegister('setup_repo_for_mushi')) {
    server.tool(
      'setup_repo_for_mushi',
      descOf('setup_repo_for_mushi'),
      {
        repo_root: z.string().describe('Absolute path to the repo root. Defaults to process.cwd() when omitted.').optional(),
        project_name: z.string().describe('Human-readable project name used in MUSHI.md. Defaults to the directory name.').optional(),
        overwrite: z.boolean().describe('When true, overwrite existing files. Default: false (skip if already present).').optional(),
      },
      annotationsFor('setup_repo_for_mushi'),
      async ({ repo_root, project_name, overwrite }) => {
        const nodePath = await import('node:path')
        const { writeFile, mkdir } = await import('node:fs/promises')
        const { existsSync } = await import('node:fs')

        // Resolve and validate the root path before any writes.
        const root = nodePath.resolve(repo_root ?? process.cwd())
        if (!existsSync(root)) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: `repo_root does not exist: ${root}` }) }] }
        }
        const name = project_name ?? nodePath.basename(root)
        const force = overwrite ?? false

        const written: string[] = []
        const skipped: string[] = []

        async function writeIfNew(rel: string, content: string) {
          // Prevent path traversal by checking the resolved abs path is still under root.
          const abs = nodePath.resolve(root, rel)
          if (!abs.startsWith(root + nodePath.sep) && abs !== root) {
            skipped.push(rel)
            return
          }
          if (!force && existsSync(abs)) {
            skipped.push(rel)
            return
          }
          await mkdir(nodePath.dirname(abs), { recursive: true })
          await writeFile(abs, content, 'utf8')
          written.push(rel)
        }

        // 1. Fetch current lessons from Mushi API
        let lessonsJson: unknown = { schema_version: '1', project_id: projectId ?? '', generated_at: new Date().toISOString(), lessons: [] }
        try {
          const raw = await apiCall<{ lessons?: unknown[] }>('/v1/sync/lessons?limit=500')
          if (raw && typeof raw === 'object') lessonsJson = raw
        } catch { /* use empty skeleton */ }

        // 2. .mushi/lessons.json
        await writeIfNew('.mushi/lessons.json', JSON.stringify(lessonsJson, null, 2) + '\n')

        // 3. .cursorrules
        const cursorrules = [
          `# Mushi Mushi — evolution-loop rules for ${name}`,
          '#',
          '# Generated by: setup_repo_for_mushi MCP tool',
          '# Refresh lessons: mushi sync-lessons',
          '',
          '## Before writing a fix',
          '1. Call get_fix_context (Mushi MCP) for the report — root cause + blast radius first.',
          '2. Read .mushi/lessons.json — apply every matching rule.',
          '3. Prefer the smallest change. Do not refactor unrelated code.',
          '',
          '## After writing a fix',
          '1. Call submit_fix_result (Mushi MCP) with branch, PR URL, and files changed.',
          '',
        ].join('\n')
        await writeIfNew('.cursorrules', cursorrules)

        // 4. MUSHI.md
        const mushiMd = [
          `# MUSHI.md — ${name}`,
          '',
          '> This file is the Mushi agent contract for this project.',
          '> Agents: read this before opening a PR.',
          '',
          '## Evolution loop',
          '',
          'This project uses Mushi\'s closed-loop PDCA cycle:',
          '',
          '```',
          'User reports bug → Mushi captures → AI triages → AI opens PR',
          '→ QA verifies → Judge scores → Lesson library remembers',
          '```',
          '',
          '## Agent checklist',
          '',
          '- [ ] Read `get_fix_context` for the report before touching any file',
          '- [ ] Check `.mushi/lessons.json` for patterns matching the affected component',
          '- [ ] Prefer the smallest change that passes the repro test',
          '- [ ] Call `submit_fix_result` after pushing the branch',
          '',
          '## Privacy',
          '',
          'Read `privacy://status` (Mushi MCP) to confirm where client data flows',
          'before dispatching a fix that touches user data fields.',
          '',
          '## Lesson library',
          '',
          'Run `mushi sync-lessons` to refresh `.mushi/lessons.json` from the',
          'project\'s live lesson library.',
          '',
        ].join('\n')
        await writeIfNew('MUSHI.md', mushiMd)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              written,
              skipped,
              message: written.length > 0
                ? `Wrote ${written.length} file(s): ${written.join(', ')}`
                : `All files already exist — run with overwrite=true to replace them.`,
            }, null, 2),
          }],
        }
      },
    )
  }

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

  return server
}
