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
import { TOOL_CATALOG } from './catalog.js'

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
  /** Base URL of the Mushi API, e.g. https://api.mushimushi.dev */
  apiEndpoint: string
  /** Project API key with `mcp:read` or `mcp:write` scope. */
  apiKey: string
  /** Optional project hint. Used to scope multi-project tools. */
  projectId?: string
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
    },
    async (args) => {
      const params = new URLSearchParams()
      if (args.status) params.set('status', args.status)
      if (args.category) params.set('category', args.category)
      if (args.severity) params.set('severity', args.severity)
      params.set('limit', String(Math.min(args.limit ?? 20, 100)))
      const data = await apiCall<{ reports: unknown[]; total: number }>(`/v1/admin/reports?${params}`)
      return jsonText(data)
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
      return jsonText(data)
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
        body: JSON.stringify({
          reportId: args.reportId,
          agent: args.agent,
          ...(projectId ? { projectId } : {}),
        }),
      })
      return jsonText(data)
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
