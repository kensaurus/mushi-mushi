/**
 * FILE: packages/server/supabase/functions/mcp/index.ts
 *
 * MCP (Model Context Protocol) Streamable HTTP transport — 2025-03-26 spec.
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 *
 * Why this file exists
 * ────────────────────
 * The agent card at `/.well-known/agent-card` has been advertising
 * `capabilities.mcp.transport = 'http+sse'` since the V5.3.2 launch, but
 * the route was never wired. Every external orchestrator (OpenAI Agents
 * SDK, Cursor remote MCP, Anthropic Claude Agent SDK in hosted mode)
 * that probed `/functions/v1/mcp` got a 404 and fell back to spawning
 * `npx @mushi-mushi/mcp` locally — which is fine for desktop clients but
 * impossible for cloud orchestrators that don't have a process to spawn.
 *
 * What it implements
 * ──────────────────
 * The Streamable HTTP transport is a SINGLE endpoint that handles three
 * verbs:
 *
 *   POST /functions/v1/mcp
 *     Body: a JSON-RPC 2.0 request (or notification).
 *     Headers: Accept: application/json, text/event-stream
 *     Response:
 *       - For requests with a result: Content-Type: application/json
 *         and the JSON-RPC response in the body.
 *       - For requests that need to stream multiple messages (currently
 *         only `tools/call` with progress notifications): Content-Type:
 *         text/event-stream; one frame per JSON-RPC message.
 *       - For notifications: 202 Accepted, empty body.
 *
 *   GET /functions/v1/mcp
 *     Headers: Accept: text/event-stream
 *     Response: an SSE stream the server may push notifications down. We
 *     emit only heartbeats today; future ticket adds notifications/list
 *     and resource subscriptions.
 *
 *   DELETE /functions/v1/mcp
 *     Terminates a session. Mushi is stateless across requests so this
 *     is a no-op that returns 200 — kept for spec compliance.
 *
 * What it does NOT implement (yet)
 * ────────────────────────────────
 * - Resumable streams via `Last-Event-ID` (we have nothing to resume).
 * - Long-lived sessions across requests via `mcp-session-id`. We accept
 *   the header for forward compat and echo it back, but every request is
 *   independent right now.
 * - Per-tool streaming progress. The existing JSON-RPC catalog returns a
 *   single result; the SSE path is wired but dormant until a tool needs
 *   to stream (e.g. `dispatch_fix` with live PDCA updates).
 *
 * Tool implementation strategy
 * ────────────────────────────
 * The Node-side `@mushi-mushi/mcp` server is a thin wrapper over the
 * `/v1/admin/*` REST API. We re-implement the same dispatch table here
 * by routing each `tools/call` to the matching REST endpoint via a
 * service-role internal call to the `api` function. This duplicates the
 * tool list (vs. importing the catalog), but keeps the Edge bundle tiny
 * and avoids pulling in the MCP SDK + zod for an Edge Function.
 *
 * Auth
 * ────
 * `Authorization: Bearer <jwt>` OR `X-Mushi-Api-Key: <key>` — same dual
 * mode as `adminOrApiKey({ scope: 'mcp:read' })` in the admin routes.
 * Tools that mutate require `mcp:write`. We call into the admin routes
 * with the caller's headers untouched so the existing RLS / scope
 * checks fire one more time at the REST layer too.
 */

import { withSentry } from '../_shared/sentry.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

// MCP protocol versions we negotiate. Order matters — we offer the
// newest first; clients that don't recognise it fall back through the
// list. 2025-03-26 introduced Streamable HTTP; 2024-11-05 was the prior
// HTTP+SSE shape. We accept the older one for clients that haven't
// upgraded yet (e.g. Claude Desktop on a stale build).
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const

const SERVER_INFO = {
  name: 'mushi-mushi',
  version: '2.0.0',
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

const ERR_PARSE = -32700
const ERR_INVALID_REQUEST = -32600
const ERR_METHOD_NOT_FOUND = -32601
const ERR_INVALID_PARAMS = -32602
const ERR_INTERNAL = -32603
// Mushi-specific: tool failed at the REST layer (HTTP error from /v1/admin/*).
const ERR_UPSTREAM_HTTP = -32000

/**
 * MCP tool registry — name → { scope required, handler }. Each handler
 * receives the parsed `params.arguments` and the auth headers we should
 * forward to the REST layer. Returns the unwrapped REST `data` envelope
 * (or throws an HttpError on a non-2xx response).
 *
 * Mirror of `packages/mcp/src/server.ts` — please keep the two in sync.
 */
type ToolHandler = (
  args: Record<string, unknown>,
  ctx: { authHeaders: Record<string, string>; projectIdHint?: string },
) => Promise<unknown>

interface ToolDef {
  scope: 'mcp:read' | 'mcp:write'
  description: string
  inputSchema: Record<string, unknown>
  /**
   * MCP 2025-06-18 outputSchema. When present, the dispatcher also emits
   * `structuredContent` alongside the text content so typed clients
   * (Claude Desktop, Cursor 0.54+) can pipe results into downstream tools
   * without re-parsing JSON. Kept in lock-step with the stdio MCP server
   * (`packages/mcp/src/server.ts`) — please update both at once.
   */
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  handler: ToolHandler
}

const TOOLS: Record<string, ToolDef> = {
  get_recent_reports: {
    scope: 'mcp:read',
    description:
      'List recent bug reports with optional filters (status / category / severity). Use this to survey what the triage queue looks like right now.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        category: { type: 'string' },
        severity: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        reports: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Array of report rows',
        },
        total: { type: 'number', description: 'Total matching rows (before limit)' },
      },
      required: ['reports'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const params = new URLSearchParams()
      if (typeof args.status === 'string') params.set('status', args.status)
      if (typeof args.category === 'string') params.set('category', args.category)
      if (typeof args.severity === 'string') params.set('severity', args.severity)
      params.set('limit', String(Math.min((args.limit as number) ?? 20, 100)))
      return apiCall(`/v1/admin/reports?${params}`, { headers: ctx.authHeaders })
    },
  },
  get_report_detail: {
    scope: 'mcp:read',
    description:
      'Full payload for a single report — description, console logs, network requests, screenshot URL, classification, fix history.',
    inputSchema: {
      type: 'object',
      required: ['reportId'],
      properties: { reportId: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.reportId, 'reportId')
      return apiCall(`/v1/admin/reports/${encodeURIComponent(args.reportId as string)}`, {
        headers: ctx.authHeaders,
      })
    },
  },
  search_reports: {
    scope: 'mcp:read',
    description:
      'Semantic + keyword search over reports. Uses pgvector similarity server-side — falls back to substring match when embeddings are unavailable.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
        threshold: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Ranked report rows with similarity scores',
        },
      },
      required: ['results'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.query, 'query')
      return apiCall(`/v1/admin/reports/similarity`, {
        method: 'POST',
        headers: ctx.authHeaders,
        body: JSON.stringify({
          query: args.query,
          k: Math.min((args.limit as number) ?? 10, 50),
          threshold: (args.threshold as number) ?? 0.2,
          ...(ctx.projectIdHint ? { projectId: ctx.projectIdHint } : {}),
        }),
      })
    },
  },
  get_fix_context: {
    scope: 'mcp:read',
    description:
      'Bundle the full context an agent needs to fix a bug: report detail, reproduction steps, component, root cause, ontology tags, AND the inventory expected_outcome contract (whitepaper §2.10) when one is declared.',
    inputSchema: {
      type: 'object',
      required: ['reportId'],
      properties: { reportId: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.reportId, 'reportId')
      const report = (await apiCall<Record<string, unknown>>(
        `/v1/admin/reports/${encodeURIComponent(args.reportId as string)}`,
        { headers: ctx.authHeaders },
      )) as Record<string, unknown>
      return {
        report,
        reproductionSteps: report.reproduction_steps ?? [],
        component: report.component,
        rootCause: (report.stage2_analysis as Record<string, unknown> | undefined)?.rootCause,
        bugOntologyTags: report.bug_ontology_tags,
        // The detail endpoint already attaches the inventory anchor when
        // available — surface it at the top so callers can branch on the
        // contract without re-walking the JSON.
        inventoryAction: (report as { inventory_action?: unknown }).inventory_action ?? null,
      }
    },
  },
  get_fix_timeline: {
    scope: 'mcp:read',
    description:
      'Ordered timeline of a fix attempt — dispatched → started → branch → commit → PR opened → CI → completed/failed.',
    inputSchema: {
      type: 'object',
      required: ['fixId'],
      properties: { fixId: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.fixId, 'fixId')
      return apiCall(`/v1/admin/fixes/${encodeURIComponent(args.fixId as string)}/timeline`, {
        headers: ctx.authHeaders,
      })
    },
  },
  inventory_get: {
    scope: 'mcp:read',
    description:
      'Current inventory.yaml snapshot for a project (latest ingest, validation errors, per-action status summary).',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const pid = (args.projectId as string | undefined) ?? ctx.projectIdHint
      if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required for inventory_get')
      return apiCall(`/v1/admin/inventory/${encodeURIComponent(pid)}`, { headers: ctx.authHeaders })
    },
  },
  inventory_findings: {
    scope: 'mcp:read',
    description:
      'Latest gate runs + findings (dead-handler, mock-leak, crawl, status-claim, agentic-failure). Filter by gate name or severity.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        gate: { type: 'string' },
        severity: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const pid = (args.projectId as string | undefined) ?? ctx.projectIdHint
      if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required for inventory_findings')
      const q = new URLSearchParams()
      if (typeof args.gate === 'string') q.set('gate', args.gate)
      if (typeof args.severity === 'string') q.set('severity', args.severity)
      const suffix = q.toString() ? `?${q}` : ''
      return apiCall(`/v1/admin/inventory/${encodeURIComponent(pid)}/findings${suffix}`, {
        headers: ctx.authHeaders,
      })
    },
  },
  graph_node_status: {
    scope: 'mcp:read',
    description: 'Fetch a single graph node row (label, type, metadata — includes derived status).',
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.nodeId, 'nodeId')
      return apiCall(`/v1/admin/graph/node/${encodeURIComponent(args.nodeId as string)}`, {
        headers: ctx.authHeaders,
      })
    },
  },
  run_nl_query: {
    scope: 'mcp:read',
    description:
      'Natural-language question → SQL query run against your project data. Read-only, rate-limited, no privileged schemas.',
    inputSchema: {
      type: 'object',
      required: ['question'],
      properties: { question: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.question, 'question')
      return apiCall(`/v1/admin/query`, {
        method: 'POST',
        headers: ctx.authHeaders,
        body: JSON.stringify({ question: args.question }),
      })
    },
  },
  dispatch_fix: {
    scope: 'mcp:write',
    description:
      'Dispatch the Mushi agentic fix orchestrator for a classified report. Returns a dispatch id; subscribe to /v1/admin/fixes/dispatch/:id/stream for live progress.',
    inputSchema: {
      type: 'object',
      required: ['reportId'],
      properties: {
        reportId: { type: 'string' },
        projectId: { type: 'string' },
        // Spec-traceability: callers that already know the inventory
        // Action they want repaired can pass it directly.
        inventoryActionNodeId: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        fixId: { type: 'string', description: 'Newly created fix_attempt UUID' },
        status: { type: 'string', description: 'Initial status (queued, running, delegated, …)' },
        agentId: { type: 'string', description: 'Cursor agent ID when agent=cursor_cloud' },
        runId: { type: 'string', description: 'Cursor run ID when agent=cursor_cloud' },
        prUrl: {
          type: 'string',
          description: 'Draft PR URL when agent=cursor_cloud and auto_create_pr=true',
        },
      },
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.reportId, 'reportId')
      const projectId = (args.projectId as string | undefined) ?? ctx.projectIdHint
      if (!projectId) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required for dispatch_fix')
      return apiCall(`/v1/admin/fixes/dispatch`, {
        method: 'POST',
        headers: ctx.authHeaders,
        body: JSON.stringify({
          reportId: args.reportId,
          projectId,
          ...(typeof args.inventoryActionNodeId === 'string'
            ? { inventoryActionNodeId: args.inventoryActionNodeId }
            : {}),
        }),
      })
    },
  },
  transition_status: {
    scope: 'mcp:write',
    description:
      'Move a report between workflow states (new → classified → grouped → fixing → fixed → dismissed).',
    inputSchema: {
      type: 'object',
      required: ['reportId', 'status'],
      properties: {
        reportId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'classified', 'grouped', 'fixing', 'fixed', 'dismissed'],
        },
        reason: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.reportId, 'reportId')
      requireString(args.status, 'status')
      return apiCall(`/v1/admin/reports/${encodeURIComponent(args.reportId as string)}`, {
        method: 'PATCH',
        headers: ctx.authHeaders,
        body: JSON.stringify({ status: args.status, reason: args.reason }),
      })
    },
  },

  // Phase 1c — token-budget lessons.query
  query_lessons: {
    scope: 'mcp:read',
    description:
      'Token-budget retrieval of relevant learning rules (lessons) for a given code diff or PR context. ' +
      'Returns ranked lessons packed within max_tokens using bi-encoder retrieval + severity-weighted scoring. ' +
      'Use this before opening a PR, writing a fix, or asking "what mistakes should I avoid in this area of code?"',
    inputSchema: {
      type: 'object',
      required: ['diff_text'],
      properties: {
        diff_text: {
          type: 'string',
          description: 'The PR diff, code snippet, or description of the change being made.',
        },
        max_tokens: {
          type: 'number',
          description: 'Maximum tokens to use for the returned lessons context (default 3000, max 8000).',
        },
        top_k: {
          type: 'number',
          description: 'Max number of lessons to return (default 15, max 50).',
        },
        project_id: {
          type: 'string',
          description: 'Filter lessons to a specific project UUID. Uses the caller\'s default project if omitted.',
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.diff_text, 'diff_text')
      return apiCall('/v1/admin/lessons/query', {
        method: 'POST',
        headers: ctx.authHeaders,
        body: JSON.stringify({
          diff_text: args.diff_text,
          max_tokens: (args.max_tokens as number) ?? 3000,
          top_k: (args.top_k as number) ?? 15,
          project_id: (args.project_id as string) ?? ctx.projectIdHint,
        }),
      })
    },
  },

  // Phase 1 — get lessons list
  list_lessons: {
    scope: 'mcp:read',
    description:
      'List promoted learning rules (lessons) for the current project. Each lesson represents a named pattern ' +
      'of mistakes that has been encoded from bug reports. Use this to understand what systemic issues have ' +
      'been identified and encoded as heuristics.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['info', 'warn', 'critical'] },
        limit: { type: 'number' },
        project_id: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const params = new URLSearchParams()
      if (typeof args.severity === 'string') params.set('severity', args.severity)
      params.set('limit', String(Math.min((args.limit as number) ?? 50, 200)))
      if (typeof args.project_id === 'string') params.set('projectId', args.project_id)
      else if (ctx.projectIdHint) params.set('projectId', ctx.projectIdHint)
      return apiCall(`/v1/admin/lessons?${params}`, { headers: ctx.authHeaders })
    },
  },

  // Setup / admin — mirror of packages/mcp/src/server.ts (setup_check +
  // ingest_setup_check). Keep both transports in lock-step.
  setup_check: {
    scope: 'mcp:read',
    description:
      'Run the 4 **dispatch-readiness** checks for a project and return their pass/fail status ' +
      '(GitHub repo connected, codebase indexed, Anthropic BYOK key present, autofix enabled). ' +
      'Also returns the target repo URL when GitHub is connected. ' +
      'Use this before calling dispatch_fix to understand why a dispatch might fail. ' +
      'For SDK ingest health (API key → heartbeat → first report), call ingest_setup_check instead.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID to check. Defaults to the API key\'s project when omitted.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        repoUrl: { type: ['string', 'null'] },
        checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
        summary: { type: 'string' },
      },
      required: ['ready', 'checks', 'summary'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const projectId = (args.projectId as string | undefined) ?? ctx.projectIdHint
      if (!projectId) {
        throw new McpError(
          ERR_INVALID_PARAMS,
          'projectId is required for setup_check when no API-key project context is available',
        )
      }
      const data = await apiCall<{
        ready: boolean
        checks: Array<{ key: string; ready: boolean; label: string; hint: string; fixHref: string }>
        repoUrl: string | null
      }>(`/v1/admin/projects/${encodeURIComponent(projectId)}/preflight`, {
        headers: ctx.authHeaders,
      })
      const checks = data.checks.map((c) => ({
        check: c.key,
        label: c.label,
        passed: c.ready,
        hint: c.hint,
        fixPath: c.fixHref,
      }))
      const failed = checks.filter((c) => !c.passed)
      return {
        ready: data.ready,
        repoUrl: data.repoUrl ?? null,
        checks,
        summary: data.ready
          ? `Project ${projectId} is ready to dispatch auto-fixes${data.repoUrl ? ` (target: ${data.repoUrl})` : ''}.`
          : `Project ${projectId} cannot dispatch yet — ${failed.map((c) => c.label).join(', ')}.`,
      }
    },
  },
  ingest_setup_check: {
    scope: 'mcp:read',
    description:
      'Run the 4 **required ingest** checks for the project tied to this API key: ' +
      'project exists, active API key, SDK heartbeat (or real report), and at least one ingested report. ' +
      'Returns per-step pass/fail plus last_sdk_seen_at and endpoint host diagnostics. ' +
      'Use after wiring env vars or pasting the SDK snippet to confirm the banner will work.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        projectId: { type: 'string' },
        projectName: { type: 'string' },
        requiredComplete: { type: 'number' },
        requiredTotal: { type: 'number' },
        steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
        diagnostic: { type: ['object', 'null'], additionalProperties: true },
        summary: { type: 'string' },
      },
      required: ['ready', 'projectId', 'projectName', 'requiredComplete', 'requiredTotal', 'steps', 'summary'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (_args, ctx) => {
      if (!ctx.projectIdHint) {
        throw new McpError(
          ERR_INVALID_PARAMS,
          'ingest_setup_check requires API-key auth (X-Mushi-Api-Key) — JWT sessions should use setup_check',
        )
      }
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
      }>('/v1/sync/ingest-setup', { headers: ctx.authHeaders })
      const failed = data.steps.filter((s) => s.required && !s.complete)
      return {
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
        summary: data.ready
          ? `Ingest setup complete (${data.required_complete}/${data.required_total}) for ${data.project_name}.`
          : `Ingest incomplete (${data.required_complete}/${data.required_total}) — still need: ${failed.map((s) => s.label).join(', ')}.`,
      }
    },
  },

  // ── Sentry-like triage + project context tools ─────────────────────────────

  list_projects: {
    scope: 'mcp:read',
    description:
      'List the Mushi projects accessible to this API key. Returns project id, name, and created date. For multi-project tokens this lists all accessible projects; for single-project keys it returns only the bound project.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (_args, ctx) => {
      return apiCall('/v1/admin/mcp/projects', { headers: ctx.authHeaders })
    },
  },

  get_project_context: {
    scope: 'mcp:read',
    description:
      'Return a rich context snapshot for a project: ingest health, SDK heartbeat, autofix readiness, open-report counts, and active integrations. Combine with get_recent_reports before triaging.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'Project UUID (falls back to key-bound project)' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const pid = (args.project_id as string | undefined) ?? ctx.projectIdHint
      if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'project_id is required')
      const qs = new URLSearchParams()
      if (pid) qs.set('project_id', pid)

      const [preflightRes, activationRes] = await Promise.allSettled([
        apiCall<unknown>(`/v1/admin/projects/${encodeURIComponent(pid)}/preflight`, { headers: ctx.authHeaders }),
        apiCall<unknown>(`/v1/admin/activation?${qs}`, { headers: ctx.authHeaders }),
      ])

      return {
        project_id: pid,
        preflight: preflightRes.status === 'fulfilled' ? preflightRes.value : { error: String(preflightRes.reason) },
        activation: activationRes.status === 'fulfilled' ? activationRes.value : { error: String(activationRes.reason) },
      }
    },
  },

  get_pipeline_logs: {
    scope: 'mcp:read',
    description:
      'Pull recent log entries from the Mushi pipeline services (fix-worker, pipeline, qa-story-runner). Accepts project_id, service, since (ISO timestamp), limit (max 200), level (all/info/warn/error) filters.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project UUID (falls back to key-bound project)' },
        service: {
          type: 'string',
          enum: ['all', 'fix-worker', 'pipeline', 'qa-story-runner'],
          description: 'Filter by service name',
        },
        since: { type: 'string', description: 'ISO timestamp — only events after this time' },
        limit: { type: 'number', description: 'Max entries to return (default 50, max 200)' },
        level: {
          type: 'string',
          enum: ['all', 'info', 'warn', 'error'],
          description: 'Min severity filter',
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const pid = (args.project_id as string | undefined) ?? ctx.projectIdHint
      if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'project_id is required')
      const qs = new URLSearchParams()
      if (args.service && args.service !== 'all') qs.set('service', args.service as string)
      if (args.since) qs.set('since', args.since as string)
      qs.set('limit', String(Math.min((args.limit as number) ?? 50, 200)))
      if (args.level) qs.set('level', args.level as string)
      return apiCall(`/v1/admin/mcp/logs/${encodeURIComponent(pid)}?${qs}`, { headers: ctx.authHeaders })
    },
  },

  get_report_evidence: {
    scope: 'mcp:read',
    description:
      'Return the focused evidence package for a single bug report: screenshot URL, console logs, network excerpts, environment info, user comments, and browser/OS data. Lighter than get_report_detail — skips the full classification/fix history.',
    inputSchema: {
      type: 'object',
      required: ['report_id'],
      properties: { report_id: { type: 'string', description: 'Report UUID' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.report_id, 'report_id')
      const [reportRes, timelineRes] = await Promise.allSettled([
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${encodeURIComponent(args.report_id as string)}`, { headers: ctx.authHeaders }),
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${encodeURIComponent(args.report_id as string)}/timeline`, { headers: ctx.authHeaders }),
      ])

      const report = reportRes.status === 'fulfilled' ? reportRes.value : null
      const timeline = timelineRes.status === 'fulfilled' ? timelineRes.value : null
      const evidence = report
        ? {
            id: report.id,
            title: report.title,
            description: report.description,
            status: report.status,
            severity: report.severity,
            category: report.category,
            screenshot_url: (report.evidence as Record<string, unknown> | null)?.screenshot_url ?? null,
            console_logs: (report.evidence as Record<string, unknown> | null)?.console ?? null,
            network_requests: (report.evidence as Record<string, unknown> | null)?.network ?? null,
            environment: report.environment ?? null,
            user_agent: report.user_agent ?? null,
            user_comments: report.comments ?? null,
            created_at: report.created_at,
          }
        : { error: String((reportRes as PromiseRejectedResult).reason) }

      return { evidence, reporter_thread: timeline ?? { error: String((timelineRes as PromiseRejectedResult).reason) } }
    },
  },

  triage_issue: {
    scope: 'mcp:read',
    description:
      'Read-only orchestration tool that combines report detail, evidence, similar bugs, fix context, blast radius, recent pipeline logs, and recommended next actions into a single triage packet. This is the primary entry point for agent-driven bug investigation.',
    inputSchema: {
      type: 'object',
      required: ['report_id'],
      properties: {
        report_id: { type: 'string', description: 'Report UUID to triage' },
        project_id: { type: 'string', description: 'Project UUID — for log context (falls back to key-bound project)' },
        include_logs: { type: 'boolean', description: 'Include recent pipeline warnings/errors (default true)' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.report_id, 'report_id')
      const pid = (args.project_id as string | undefined) ?? ctx.projectIdHint
      const includeLogs = args.include_logs !== false

      const [reportRes, timelineRes, similarRes, fixCtxRes, blastRes, logsRes] = await Promise.allSettled([
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${encodeURIComponent(args.report_id as string)}`, { headers: ctx.authHeaders }),
        apiCall<Record<string, unknown>>(`/v1/admin/reports/${encodeURIComponent(args.report_id as string)}/timeline`, { headers: ctx.authHeaders }),
        apiCall<unknown>('/v1/admin/reports/similarity', {
          method: 'POST',
          headers: ctx.authHeaders,
          body: JSON.stringify({ report_id: args.report_id }),
        }).catch(() => null),
        pid
          ? apiCall<unknown>(`/v1/admin/reports/${encodeURIComponent(args.report_id as string)}/fix-context`, { headers: ctx.authHeaders }).catch(() => null)
          : Promise.resolve(null),
        pid
          ? apiCall<unknown>(`/v1/admin/reports/${encodeURIComponent(args.report_id as string)}/blast-radius`, { headers: ctx.authHeaders }).catch(() => null)
          : Promise.resolve(null),
        includeLogs && pid
          ? apiCall<unknown>(`/v1/admin/mcp/logs/${encodeURIComponent(pid)}?limit=20&level=warn`, { headers: ctx.authHeaders }).catch(() => null)
          : Promise.resolve(null),
      ])

      const report = reportRes.status === 'fulfilled' ? reportRes.value : null
      const severity = report?.severity ?? 'unknown'
      const status = report?.status ?? 'unknown'

      const actions: Array<{ action: string; reason: string }> = []
      if (status === 'open' || status === 'triage') {
        actions.push({ action: 'dispatch_fix', reason: 'Report is open — initiate an automated fix attempt.' })
      } else if (status === 'fixing') {
        actions.push({ action: 'get_fix_context', reason: 'Fix is in progress — check fix context for details.' })
      } else if (status === 'fixed') {
        actions.push({ action: 'close_report', reason: 'Fix has been applied — verify and close the report.' })
      }
      if (severity === 'critical' || severity === 'high') {
        actions.push({ action: 'get_blast_radius', reason: 'High severity — check blast radius for affected scope.' })
      }

      return {
        report: report ?? { error: String((reportRes as PromiseRejectedResult).reason) },
        evidence_thread: timelineRes.status === 'fulfilled' ? timelineRes.value : null,
        similar_reports: similarRes.status === 'fulfilled' ? similarRes.value : null,
        fix_context: fixCtxRes.status === 'fulfilled' ? fixCtxRes.value : null,
        blast_radius: blastRes.status === 'fulfilled' ? blastRes.value : null,
        pipeline_logs: logsRes.status === 'fulfilled' ? logsRes.value : null,
        recommended_actions: actions,
        triage_summary: report
          ? `[${severity?.toString().toUpperCase()}] "${report.title ?? report.id}" — status: ${status}. ${actions.length} recommended action(s).`
          : 'Could not fetch report.',
      }
    },
  },
}

// ----------------------------------------------------------------------------
// JSON-RPC dispatcher
// ----------------------------------------------------------------------------

class McpError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message)
    this.name = 'McpError'
  }
}

function requireString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new McpError(ERR_INVALID_PARAMS, `${name} is required`)
  }
}

interface CallContext {
  authHeaders: Record<string, string>
  scope: 'mcp:read' | 'mcp:write' | null
  projectIdHint?: string
}

async function dispatchRpc(req: JsonRpcRequest, ctx: CallContext): Promise<JsonRpcSuccess | JsonRpcError | null> {
  const id = req.id ?? null

  // Notifications: id is absent. Per JSON-RPC, we MUST NOT respond.
  const isNotification = req.id === undefined

  try {
    let result: unknown
    switch (req.method) {
      case 'initialize':
        result = handleInitialize(req.params ?? {})
        break
      case 'notifications/initialized':
      case 'initialized':
        // Client signalling it's ready — no response.
        return null
      case 'ping':
        result = {}
        break
      case 'tools/list':
        result = handleToolsList(ctx)
        break
      case 'tools/call':
        result = await handleToolsCall(req.params ?? {}, ctx)
        break
      case 'resources/list':
        result = handleResourcesList()
        break
      case 'resources/read':
        result = await handleResourcesRead(req.params ?? {}, ctx)
        break
      case 'resources/subscribe':
        // Client wants push updates for a resource URI. We acknowledge the
        // subscription here; actual push notifications are sent down the
        // GET SSE pipe when the `inventories` table changes.
        result = {}
        break
      case 'resources/unsubscribe':
        result = {}
        break
      case 'prompts/list':
        result = handlePromptsList()
        break
      case 'prompts/get':
        result = handlePromptsGet(req.params ?? {})
        break
      default:
        if (isNotification) return null
        return { jsonrpc: '2.0', id, error: { code: ERR_METHOD_NOT_FOUND, message: `Method not found: ${req.method}` } }
    }
    if (isNotification) return null
    return { jsonrpc: '2.0', id, result }
  } catch (err) {
    if (isNotification) return null
    if (err instanceof McpError) {
      return { jsonrpc: '2.0', id, error: { code: err.code, message: err.message, data: err.data } }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { jsonrpc: '2.0', id, error: { code: ERR_INTERNAL, message } }
  }
}

function handleInitialize(params: Record<string, unknown>): unknown {
  const clientWanted = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
  const negotiated =
    SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === clientWanted) ?? SUPPORTED_PROTOCOL_VERSIONS[0]
  return {
    protocolVersion: negotiated,
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: true, subscribe: true },
      prompts: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
    instructions:
      'Mushi Mushi MCP server. Read-only by default; mutations require an API key with `mcp:write` scope. ' +
      'Spec-traceability (whitepaper §2.10): pass `inventoryActionNodeId` to `dispatch_fix` when you know the ' +
      'action you want repaired so the agent has the contract verbatim in-prompt. ' +
      'Subscribe to `inventory://current` to get pushed updates whenever the inventory snapshot changes.',
  }
}

/**
 * `tools/list` filters by the caller's scope so a read-only API key
 * never sees `dispatch_fix` (etc.) in its catalog. This mirrors the
 * stdio MCP server's `registerScopedTool` behaviour and saves an
 * INSUFFICIENT_SCOPE round-trip for every LLM that picks the tool
 * blind. Includes `outputSchema` when defined (MCP 2025-06-18).
 */
function handleToolsList(ctx: CallContext): unknown {
  return {
    tools: Object.entries(TOOLS)
      .filter(([, def]) => isToolGrantedToScope(def.scope, ctx.scope))
      .map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.inputSchema,
        ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}),
        annotations: def.annotations,
      })),
  }
}

function isToolGrantedToScope(
  required: 'mcp:read' | 'mcp:write',
  caller: 'mcp:read' | 'mcp:write' | null,
): boolean {
  if (!caller) return false
  if (required === 'mcp:read') return true // both scopes can read
  return caller === 'mcp:write' // only write scope can write
}

async function handleToolsCall(
  params: Record<string, unknown>,
  ctx: CallContext,
): Promise<unknown> {
  const name = params.name
  if (typeof name !== 'string') throw new McpError(ERR_INVALID_PARAMS, 'tools/call requires a string `name`')
  const def = TOOLS[name]
  if (!def) throw new McpError(ERR_METHOD_NOT_FOUND, `tool not found: ${name}`)
  // Scope gate. Anonymous clients (somehow past auth — shouldn't be
  // possible but defence in depth) get nothing. mcp:write implies read.
  if (!ctx.scope) throw new McpError(ERR_INVALID_REQUEST, 'caller has no scope')
  if (!isToolGrantedToScope(def.scope, ctx.scope)) {
    throw new McpError(
      ERR_INVALID_REQUEST,
      `tool "${name}" requires ${def.scope} scope; caller holds ${ctx.scope}`,
    )
  }
  const args = (params.arguments as Record<string, unknown> | undefined) ?? {}
  const data = await def.handler(args, { authHeaders: ctx.authHeaders, projectIdHint: ctx.projectIdHint })
  // Modern clients read structuredContent directly (no re-parse). Older
  // clients fall back to the text content. Only emit structuredContent
  // when the tool defines an outputSchema AND the data is an object —
  // a bare array or scalar would fail downstream JSON-Schema validation.
  const includeStructured = !!def.outputSchema && typeof data === 'object' && data !== null
  const result: Record<string, unknown> = {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
  if (includeStructured) {
    result.structuredContent = data
  }
  return result
}

function handleResourcesList(): unknown {
  return {
    resources: [
      { uri: 'project://dashboard', name: 'project_dashboard', description: 'PDCA snapshot', mimeType: 'application/json' },
      { uri: 'project://stats', name: 'project_stats', description: 'Report stats', mimeType: 'application/json' },
      { uri: 'project://settings', name: 'project_settings', description: 'Project settings', mimeType: 'application/json' },
      {
        uri: 'inventory://current',
        name: 'inventory_current',
        description:
          'Current inventory.yaml snapshot — all pages, user stories, actions, and their ' +
          'expected_outcome contracts. Subscribable: the MCP server pushes ' +
          '`notifications/resources/updated` when a new inventory is ingested so orchestrators ' +
          'never hold a stale contract.',
        mimeType: 'application/json',
      },
    ],
  }
}

async function handleResourcesRead(params: Record<string, unknown>, ctx: CallContext): Promise<unknown> {
  const uri = params.uri
  if (typeof uri !== 'string') throw new McpError(ERR_INVALID_PARAMS, 'resources/read requires a string `uri`')
  const path =
    uri === 'project://dashboard' ? '/v1/admin/dashboard'
    : uri === 'project://stats' ? '/v1/admin/stats'
    : uri === 'project://settings' ? '/v1/admin/settings'
    : uri === 'inventory://current'
      ? (ctx.projectIdHint ? `/v1/admin/inventory/${encodeURIComponent(ctx.projectIdHint)}` : null)
      : null
  if (uri === 'inventory://current' && !ctx.projectIdHint) {
    throw new McpError(ERR_INVALID_PARAMS, 'inventory://current requires a project context; set X-Mushi-Project header or pass projectId')
  }
  if (!path) throw new McpError(ERR_INVALID_PARAMS, `unknown resource uri: ${uri}`)
  const data = await apiCall(path, { headers: ctx.authHeaders })
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
  }
}

function handlePromptsList(): unknown {
  return {
    prompts: [
      {
        name: 'summarize_report_for_fix',
        description: 'Turn a Mushi report into a one-line root cause + smallest file set + repro + blast radius.',
        arguments: [{ name: 'reportId', description: 'The report UUID', required: true }],
      },
      {
        name: 'explain_judge_result',
        description: 'Turn raw Sonnet-as-Judge scores into ship / iterate / dismiss guidance.',
        arguments: [{ name: 'fixId', description: 'fix_attempt UUID', required: true }],
      },
      {
        name: 'triage_next_steps',
        description: 'Five-item priority list drawn from the dashboard + recent classified queue.',
        arguments: [],
      },
    ],
  }
}

function handlePromptsGet(params: Record<string, unknown>): unknown {
  const name = params.name
  if (typeof name !== 'string') throw new McpError(ERR_INVALID_PARAMS, 'prompts/get requires a string `name`')
  const args = (params.arguments as Record<string, unknown> | undefined) ?? {}
  const reportId = typeof args.reportId === 'string' ? args.reportId : '<reportId>'
  const fixId = typeof args.fixId === 'string' ? args.fixId : '<fixId>'
  const text =
    name === 'summarize_report_for_fix'
      ? `Use the Mushi MCP tools to:\n1. Call get_fix_context for reportId "${reportId}".\n2. Call get_blast_radius if the report has a component node id.\n3. Call get_similar_bugs with the component or summary as the query.\n\nThen produce a markdown fix plan with: One-line root cause, files likely to change, reproduction steps, blast-radius warnings, confidence.`
      : name === 'explain_judge_result'
      ? `Use Mushi MCP tools:\n1. Call get_fix_timeline for fixId "${fixId}".\n\nThen write a short verdict: Recommendation: ship / iterate / dismiss. Why (1-2 sentences). If iterate: smallest next patch.`
      : name === 'triage_next_steps'
      ? `Use the Mushi MCP tools:\n1. Read project://dashboard.\n2. Call get_recent_reports with status="classified", limit=10.\n\nOutput exactly 5 prioritised bullets, each: "**Action** — why it matters — suggested tool call".`
      : null
  if (text === null) throw new McpError(ERR_METHOD_NOT_FOUND, `unknown prompt: ${name}`)
  return {
    description: `Mushi prompt: ${name}`,
    messages: [
      { role: 'user', content: { type: 'text', text } },
    ],
  }
}

// ----------------------------------------------------------------------------
// REST proxy — forwards to the api function. Re-uses caller auth so RLS +
// scope checks fire one more time at the admin route layer.
// ----------------------------------------------------------------------------

async function apiCall<T = unknown>(
  path: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<T> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) throw new McpError(ERR_INTERNAL, 'SUPABASE_URL not configured')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init.headers,
  }
  const res = await fetch(`${supabaseUrl}/functions/v1/api${path}`, { ...init, headers })
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
    const env = body as { error?: { code?: string; message?: string } } | null
    throw new McpError(
      ERR_UPSTREAM_HTTP,
      env?.error?.message ?? `Upstream ${res.status}`,
      { http: res.status, code: env?.error?.code ?? `HTTP_${res.status}` },
    )
  }
  const env = body as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null
  if (env && typeof env === 'object' && 'ok' in env) {
    if (!env.ok) {
      throw new McpError(
        ERR_UPSTREAM_HTTP,
        env.error?.message ?? 'Upstream returned ok=false',
        { code: env.error?.code ?? 'API_ERROR' },
      )
    }
    return (env.data ?? ({} as T)) as T
  }
  return body as T
}

// ----------------------------------------------------------------------------
// Auth — dual mode (API key OR JWT). Validates the key against
// `project_api_keys` via service-role; for JWT we rely on the downstream
// `api` function's `jwtAuth` to do the heavy lifting (we just check the
// header is present so we can refuse unauth at the MCP edge).
// ----------------------------------------------------------------------------

async function resolveAuth(req: Request): Promise<CallContext> {
  const apiKey = req.headers.get('X-Mushi-Api-Key')
  if (apiKey) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new McpError(ERR_INTERNAL, 'Server not configured for API-key auth')
    }
    const keyHashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey))
    const keyHash = Array.from(new Uint8Array(keyHashBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    // Minimal direct PostgREST query against project_api_keys. We don't
    // import @supabase/supabase-js here to keep the bundle tiny — the
    // table query is a single REST call.
    const res = await fetch(
      `${supabaseUrl}/rest/v1/project_api_keys?key_hash=eq.${encodeURIComponent(keyHash)}&is_active=eq.true&select=project_id,scopes,owner_user_id`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
      },
    )
    if (!res.ok) throw new McpError(ERR_INVALID_REQUEST, 'API key lookup failed')
    const rows = (await res.json()) as Array<{
      project_id: string
      scopes: string[] | null
      owner_user_id: string | null
    }>
    const row = rows[0]
    if (!row) throw new McpError(ERR_INVALID_REQUEST, 'Invalid or revoked API key')
    const scopes = row.scopes ?? []
    const scope: 'mcp:read' | 'mcp:write' | null = scopes.includes('mcp:write')
      ? 'mcp:write'
      : scopes.includes('mcp:read')
      ? 'mcp:read'
      : null
    if (!scope) throw new McpError(ERR_INVALID_REQUEST, 'API key has no MCP scope')
    return {
      // Forward the API key so the downstream /v1/admin/* calls re-validate
      // it via adminOrApiKey({ scope }) and inherit RLS.
      authHeaders: {
        'X-Mushi-Api-Key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
      scope,
      projectIdHint: row.project_id,
    }
  }

  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    // Pass the JWT through. The downstream api function does the heavy
    // validation via db.auth.getUser(token) — we don't duplicate that
    // here because (a) it requires the supabase-js client we deliberately
    // avoid bundling, and (b) any MCP tool will fan-out to /v1/admin/*
    // which fails closed if the JWT is bad. JWT callers are owners, so
    // they get the implicit superset scope.
    return {
      authHeaders: { Authorization: auth },
      scope: 'mcp:write',
    }
  }

  throw new McpError(
    ERR_INVALID_REQUEST,
    'Authentication required: send X-Mushi-Api-Key (preferred) or Authorization: Bearer <jwt>',
  )
}

// ----------------------------------------------------------------------------
// HTTP entry — Streamable HTTP per MCP 2025-03-26
// ----------------------------------------------------------------------------

const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS'
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': ALLOWED_METHODS,
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Mushi-Api-Key, X-Mushi-Project, MCP-Session-Id, MCP-Protocol-Version',
  'Access-Control-Max-Age': '600',
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // Spec metadata GET (without Accept: text/event-stream) — return the
  // MCP server descriptor so curl-style probes can confirm the endpoint
  // is alive without negotiating SSE. Not in the spec but very useful.
  if (req.method === 'GET') {
    const accept = req.headers.get('Accept') ?? ''
    if (!accept.includes('text/event-stream')) {
      return new Response(
        JSON.stringify({
          ok: true,
          server: SERVER_INFO,
          protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
          transports: ['streamable-http'],
          docs: 'https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      )
    }
    // Auth + open SSE. We have no server-initiated messages today; emit
    // heartbeats so proxies don't kill the connection and the client
    // reconnect logic stays warm. If a future feature adds notifications
    // (resource changes, dispatch progress) it streams down this pipe.
    let ctx: CallContext
    try {
      ctx = await resolveAuth(req)
    } catch (err) {
      const e = err as McpError
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: e.code, message: e.message } }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      )
    }
    void ctx
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(`: mushi-mcp-stream open ${Date.now()}\n\n`))

        // Poll the `inventories` table for new snapshots and push
        // `notifications/resources/updated` when one arrives.
        // We use polling (15s interval) instead of Supabase Realtime because
        // the Edge Function's SSE pipe already carries heartbeats on the same
        // interval and adding a Realtime subscription would double the socket count.
        let lastInventoryTs: string | null = null

        const checkInventoryChange = async () => {
          try {
            const apiBase = Deno.env.get('SUPABASE_URL') ?? ''
            const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
            // Use the project hint from auth headers when available.
            const projectId = ctx.projectIdHint
            if (!projectId || !apiBase) return
            // Watch the row currently flagged `is_current` and use its
            // `ingested_at` as the change-detector key. We only fire a
            // notification when the active snapshot's identity changes —
            // either because a new inventory was ingested OR because the
            // `is_current` pointer was flipped to an older row (rare, but
            // happens during rollback).
            const q = new URLSearchParams({
              select: 'id,ingested_at',
              project_id: `eq.${projectId}`,
              is_current: 'eq.true',
              order: 'ingested_at.desc',
              limit: '1',
            })
            const res = await fetch(`${apiBase}/rest/v1/inventories?${q}`, {
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? anonKey}`,
              },
            })
            if (!res.ok) return
            const rows = await res.json() as Array<{ id: string; ingested_at: string }>
            if (!rows.length) return
            // Fingerprint = id + ingested_at — catches both a new ingest
            // (new id) and an is_current flip on an existing row.
            const fingerprint = `${rows[0].id}@${rows[0].ingested_at}`
            if (lastInventoryTs !== null && fingerprint !== lastInventoryTs) {
              const notification = JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/resources/updated',
                params: { uri: 'inventory://current' },
              })
              controller.enqueue(enc.encode(`data: ${notification}\n\n`))
            }
            lastInventoryTs = fingerprint
          } catch { /* non-fatal: inventory push is best-effort */ }
        }

        const interval = setInterval(async () => {
          try {
            controller.enqueue(enc.encode(`: heartbeat ${Date.now()}\n\n`))
            await checkInventoryChange()
          } catch {
            clearInterval(interval)
          }
        }, 15_000)
        // Auto-close after 10 min so a dropped client doesn't pin the
        // Edge runtime indefinitely. Spec-compliant clients will reconnect.
        setTimeout(() => {
          clearInterval(interval)
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }, 10 * 60_000)
      },
    })
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...CORS_HEADERS,
      },
    })
  }

  if (req.method === 'DELETE') {
    // Sessions are stateless today — accept the close request and ack.
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: `Use one of: ${ALLOWED_METHODS}` } }),
      { status: 405, headers: { 'Content-Type': 'application/json', Allow: ALLOWED_METHODS, ...CORS_HEADERS } },
    )
  }

  let ctx: CallContext
  try {
    ctx = await resolveAuth(req)
  } catch (err) {
    const e = err as McpError
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: e.code, message: e.message } }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    )
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonRpcResponse({ jsonrpc: '2.0', id: null, error: { code: ERR_PARSE, message: 'Invalid JSON' } })
  }

  // Spec: a POST body MAY be a single request OR a batch (array).
  if (Array.isArray(payload)) {
    const responses: Array<JsonRpcSuccess | JsonRpcError> = []
    for (const entry of payload) {
      const r = await dispatchRpc(entry as JsonRpcRequest, ctx)
      if (r) responses.push(r)
    }
    if (responses.length === 0) {
      // All notifications — spec allows 202 Accepted with empty body.
      return new Response(null, { status: 202, headers: CORS_HEADERS })
    }
    return jsonRpcResponse(responses)
  }

  const rpc = payload as JsonRpcRequest
  if (!rpc || typeof rpc !== 'object' || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return jsonRpcResponse({
      jsonrpc: '2.0',
      id: (rpc as { id?: string | number | null } | null)?.id ?? null,
      error: { code: ERR_INVALID_REQUEST, message: 'Not a JSON-RPC 2.0 request' },
    })
  }

  const response = await dispatchRpc(rpc, ctx)
  if (!response) {
    // Notification — no response.
    return new Response(null, { status: 202, headers: CORS_HEADERS })
  }
  return jsonRpcResponse(response)
}

function jsonRpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('mcp', handler))
}
