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
import { propagateRequestId } from '../_shared/internal-headers.ts'
import { recordMcpToolInvocation } from '../_shared/mcp-tool-audit.ts'
import { claimMcpToolCallRateLimit, buildRateLimitHeaders } from '../_shared/mcp-rate-limit.ts'
import { buildManifestTools } from './manifest-tools.ts'
import { SERVER_INFO_EXTENDED, MUSHI_ICON_SVG_INLINE } from '../_shared/mcp-branding.ts'
import { parseFeaturesParam, toolMatchesFeatures, DEPRECATED_TOOL_ALIASES, type FeatureFilter } from './feature-groups.ts'
import { wrapUntrustedJson } from './wrap-untrusted.ts'
import { searchMushiDocs } from './docs-index.ts'
import { buildMcpServerCard, MCP_SERVER_CARD_HEADERS } from '../_shared/mcp-server-card.ts'
import {
  buildOAuthAuthorizationServerMetadata,
  buildOAuthProtectedResourceMetadata,
  bearerWwwAuthenticateResourceMetadata,
  mcpProtectedResourceMetadataUrl,
  MCP_OAUTH_AS_METADATA_HEADERS,
  MCP_OAUTH_METADATA_HEADERS,
} from '../_shared/mcp-oauth-metadata.ts'
import {
  buildSmitheryAuthorizeRedirect,
  buildSmitheryTokenResponse,
  isSmitheryRedirectUri,
} from '../_shared/mcp-oauth-smithery-stub.ts'
import { readOAuthParams } from '../_shared/mcp-oauth-helpers.ts'
import { callLinearMcpTool } from '../_shared/linear-mcp-client.ts'
import { getServiceClient as getLinearServiceClient } from '../_shared/db.ts'

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

const SERVER_INFO = SERVER_INFO_EXTENDED

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
// Mushi-specific: caller exceeded the per-actor tools/call budget (see
// _shared/mcp-rate-limit.ts). `error.data.retryAfterSeconds` tells the
// client how long to back off.
const ERR_RATE_LIMITED = -32001

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

const BASE_TOOLS: Record<string, ToolDef> = {
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
  get_inventory: {
    scope: 'mcp:read',
    description:
      'Return the current inventory.yaml snapshot for a project: latest ingest, validation errors, and a per-action status summary. Use diff_inventory to compare two commits or list_gate_findings for the latest gate results.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const pid = (args.projectId as string | undefined) ?? ctx.projectIdHint
      if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required for get_inventory')
      return apiCall(`/v1/admin/inventory/${encodeURIComponent(pid)}`, { headers: ctx.authHeaders })
    },
  },
  list_gate_findings: {
    scope: 'mcp:read',
    description:
      'List the most recent inventory gate findings for a project, newest run first (dead-handler, mock-leak, crawl, status-claim, agentic-failure). Filter by gate name or minimum severity. Use diff_inventory to compare commits or get_inventory for the full snapshot.',
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
      if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required for list_gate_findings')
      const q = new URLSearchParams()
      if (typeof args.gate === 'string') q.set('gate', args.gate)
      if (typeof args.severity === 'string') q.set('severity', args.severity)
      const suffix = q.toString() ? `?${q}` : ''
      return apiCall(`/v1/admin/inventory/${encodeURIComponent(pid)}/findings${suffix}`, {
        headers: ctx.authHeaders,
      })
    },
  },
  get_graph_node: {
    scope: 'mcp:read',
    description: 'Fetch one knowledge-graph node row by id (label, type, metadata — includes the derived status on Action nodes). Use get_graph_neighborhood to see what connects to it.',
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
  get_blast_radius: {
    scope: 'mcp:read',
    description:
      'Return the blast radius for a codebase node: all downstream dependents and their weighted impact scores. ' +
      'Use this to understand how far a change (or bug fix) propagates before deciding to dispatch a fix.',
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: { type: 'string', description: 'Graph node ID (component, file, or function label)' } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.nodeId, 'nodeId')
      return apiCall(`/v1/admin/graph/blast-radius/${encodeURIComponent(args.nodeId as string)}`, {
        headers: ctx.authHeaders,
      })
    },
  },

  get_knowledge_graph: {
    scope: 'mcp:read',
    description:
      'Traverse the codebase knowledge graph from a seed node. Returns nodes and edges within the given depth. ' +
      'Depth 1 = direct dependents; depth 2 = transitive. Max depth 3.',
    inputSchema: {
      type: 'object',
      required: ['seed'],
      properties: {
        seed: { type: 'string', description: 'Starting node label (e.g. component name, file path)' },
        depth: { type: 'number', description: 'Traversal depth (default 2, max 3)' },
        project_id: { type: 'string', description: 'Project UUID (falls back to key-bound project)' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      requireString(args.seed, 'seed')
      const qs = new URLSearchParams()
      qs.set('seed', args.seed as string)
      qs.set('depth', String(Math.min((args.depth as number) ?? 2, 3)))
      const pid = (args.project_id as string | undefined) ?? ctx.projectIdHint
      if (pid) qs.set('projectId', pid)
      return apiCall(`/v1/admin/graph/traverse?${qs}`, { headers: ctx.authHeaders })
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

  // activation_status — thin wrapper matching the npm package's tool (the
  // resource mushi://activation is HTTP-only; this entry exposes the same
  // data as a callable MCP tool so both tool-callers and resource-readers work).
  activation_status: {
    scope: 'mcp:read',
    description:
      'Return the unified activation posture — SDK heartbeat, reports, GitHub, MCP readiness, QA stories, and the next best action. Returns the same payload as the activation_status resource.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project UUID (defaults to key-bound project).' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const pid = (args.project_id as string | undefined) ?? ctx.projectIdHint
      const qs = pid ? `?project_id=${encodeURIComponent(pid)}` : ''
      return apiCall<unknown>(`/v1/admin/activation${qs}`, { headers: ctx.authHeaders })
    },
  },

  // Setup / admin — mirror of packages/mcp/src/server.ts. The single
  // diagnose_setup entry point covers ingest + dispatch readiness; keep both
  // transports in lock-step.
  diagnose_setup: {
    scope: 'mcp:read',
    description:
      'Diagnose Mushi setup health and return the single best next action. mode=full (default) runs both SDK-ingest and fix-dispatch preflight checks; mode=ingest runs ingest checks only; mode=dispatch runs dispatch readiness only. The one setup-diagnosis entry point — use this instead of separate connection/ingest checks.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['full', 'ingest', 'dispatch'], description: 'Which checks to run (default full).' },
        project_id: { type: 'string', description: 'Project UUID for dispatch checks.' },
        projectId: { type: 'string', description: 'Alias for project_id.' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        ready: { type: 'boolean' },
        summary: { type: 'string' },
        nextAction: { type: 'string' },
        connection: { type: ['object', 'null'], additionalProperties: true },
        ingest: { type: 'object', additionalProperties: true },
        dispatch: { type: ['object', 'null'], additionalProperties: true },
      },
      required: ['mode', 'ready', 'summary'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const mode = (args.mode as string | undefined) ?? 'full'
      const resolvedId = (args.project_id as string | undefined) ??
        (args.projectId as string | undefined) ??
        ctx.projectIdHint

      if (mode === 'ingest') {
        const data = await apiCall<{
          ready: boolean
          required_complete: number
          required_total: number
          project_id: string
          project_name: string
          steps: Array<{ id: string; label: string; complete: boolean; required: boolean; hint: string }>
          diagnostic?: Record<string, unknown>
        }>('/v1/sync/ingest-setup', { headers: ctx.authHeaders })
        const failed = data.steps.filter((s) => s.required && !s.complete)
        return {
          mode: 'ingest',
          ready: data.ready,
          summary: data.ready
            ? `Ingest setup complete for ${data.project_name}.`
            : `Ingest incomplete — ${failed.map((s) => s.label).join(', ')}.`,
          nextAction: failed[0]?.hint,
          ingest: data,
        }
      }

      if (mode === 'dispatch') {
        if (!resolvedId) {
          throw new McpError(ERR_INVALID_PARAMS, 'project_id is required for dispatch mode')
        }
        const data = await apiCall<{
          ready: boolean
          checks: Array<{ key: string; ready: boolean; label: string; hint: string }>
          repoUrl: string | null
        }>(`/v1/admin/projects/${encodeURIComponent(resolvedId)}/preflight`, { headers: ctx.authHeaders })
        const failed = data.checks.filter((c) => !c.ready)
        return {
          mode: 'dispatch',
          ready: data.ready,
          summary: data.ready
            ? `Project ${resolvedId} is ready to dispatch auto-fixes.`
            : `Dispatch blocked — ${failed.map((c) => c.label).join(', ')}.`,
          nextAction: failed[0]?.hint,
          dispatch: data,
        }
      }

      // ── Connection probes (restored from diagnose_connection) ──────────────
      // These catch INVALID_TOKEN / endpoint / no-projects issues before the
      // ingest/dispatch calls which would surface them as cryptic 401s.
      const connIssues: Array<{ check: string; detail: string; fix: string }> = []
      const apiEndpoint = ctx.authHeaders['X-Mushi-Api-Endpoint'] ?? ''
      const apiKey = ctx.authHeaders['X-Mushi-Api-Key'] ?? ctx.authHeaders['Authorization']?.replace(/^Bearer /, '') ?? ''

      if (!apiKey.startsWith('mushi_')) {
        connIssues.push({
          check: 'mcp_api_key',
          detail: 'MCP server API key missing or malformed (expected prefix: mushi_)',
          fix: 'Run `mushi connect` or set MUSHI_API_KEY to a valid key in your MCP config.',
        })
      }

      let healthOk = false
      if (apiEndpoint) {
        try {
          const healthRes = await fetch(`${apiEndpoint.replace(/\/$/, '')}/health`, {
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
            { headers: ctx.authHeaders },
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
      }>('/v1/sync/ingest-setup', { headers: ctx.authHeaders })
      let dispatchReady = true
      let dispatchBlock: string | undefined
      let dispatchPayload: unknown = null
      if (resolvedId) {
        try {
          const preflight = await apiCall<{
            ready: boolean
            checks: Array<{ label: string; ready: boolean; hint: string }>
          }>(`/v1/admin/projects/${encodeURIComponent(resolvedId)}/preflight`, { headers: ctx.authHeaders })
          dispatchReady = preflight.ready
          dispatchPayload = preflight
          if (!preflight.ready) {
            dispatchBlock = preflight.checks.filter((c) => !c.ready)[0]?.hint
          }
        } catch {
          dispatchReady = false
          dispatchBlock = 'Could not run dispatch preflight — verify project_id and API key scope.'
        }
      }
      const ingestFailed = ingest.steps.filter((s) => s.required && !s.complete)
      const connOk = connIssues.length === 0
      const ready = connOk && ingest.ready && dispatchReady
      const nextAction = !connOk
        ? (connIssues[0]?.fix ?? 'Fix the connection issue above.')
        : !ingest.ready
        ? (ingestFailed[0]?.hint ?? 'Complete SDK ingest setup.')
        : !dispatchReady
        ? (dispatchBlock ?? 'Complete dispatch preflight in Settings → Integrations.')
        : 'All setup checks pass.'
      return {
        mode: 'full',
        ready,
        summary: ready
          ? 'Mushi connection, ingest, and dispatch setup look healthy.'
          : !connOk
          ? `Connection issue — ${connIssues[0]?.check}: ${connIssues[0]?.detail}`
          : 'Setup incomplete — see nextAction.',
        nextAction,
        connection: {
          healthOk,
          endpoint: apiEndpoint || null,
          projectId: resolvedId ?? null,
          accessibleProjectCount,
          issues: connIssues,
        },
        ingest,
        dispatch: resolvedId ? dispatchPayload : null,
      }
    },
  },

  search_mushi_docs: {
    scope: 'mcp:read',
    description:
      'Search official Mushi docs (guides, MCP setup, inventory, QA, skills) by keyword. ' +
      'Returns ranked page titles, URLs, and excerpts.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Keywords to search.' },
        limit: { type: 'number', description: 'Max results (default 8, max 20).' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              path: { type: 'string' },
              excerpt: { type: 'string' },
              score: { type: 'number' },
            },
            required: ['title', 'path', 'excerpt', 'score'],
          },
        },
      },
      required: ['query', 'results'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const query = String(args.query ?? '')
      const limit = Math.min(Number(args.limit ?? 8), 20)
      const hits = searchMushiDocs(query, limit)
      const results = hits.map(({ title, path, excerpt, score }) => ({ title, path, excerpt, score }))
      return { query, results }
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

  // ── Usage / billing ─────────────────────────────────────────────────────────

  get_usage: {
    scope: 'mcp:read',
    description:
      'Read-only diagnoses quota and billing summary for the current project: diagnoses used / limit / percentage, spend cap, period start/end, plan name, and whether the project is approaching or over its quota. Use this to answer "how many diagnoses do I have left?" or "am I close to my spend cap?".',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project UUID (falls back to key-bound project).' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string' },
        diagnosesUsed: { type: 'number' },
        diagnosesLimit: { type: ['number', 'null'] },
        diagnosesUsagePct: { type: ['number', 'null'] },
        overDiagnosisQuota: { type: 'boolean' },
        approachingDiagnosisQuota: { type: 'boolean' },
        monthlySpendCapUsd: { type: ['number', 'null'] },
        periodEnd: { type: ['string', 'null'] },
        freeLimitDiagnoses: { type: 'number' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args, ctx) => {
      const pid = String(args.project_id ?? ctx.projectIdHint ?? '')
      const path = pid ? `/v1/admin/billing/stats?project_id=${encodeURIComponent(pid)}` : '/v1/admin/billing/stats'
      return apiCall(path, { headers: ctx.authHeaders })
    },
  },

  // ── use_mushi meta-tool ──────────────────────────────────────────────────
  // Returns a curated tool subset + orientation for the caller's stated intent.
  // Mirrors the stdio MCP server (packages/mcp/src/server.ts).  Intent map
  // is inlined here (edge functions cannot import from packages/).
  use_mushi: {
    scope: 'mcp:read',
    description:
      'CALL THIS FIRST if you are new to this Mushi project or unsure which tool to use. ' +
      'Pass your intent as a short natural-language phrase ' +
      '("fix the top bug", "check what I should work on", "run QA tests", "set up Mushi", …). ' +
      'Returns: (1) a curated list of the 5–12 tool names most relevant to that intent, ' +
      '(2) a one-paragraph orientation to the Mushi project and dashboard state, and ' +
      '(3) the single recommended first tool to call. ' +
      'Avoids loading the full 68-tool catalog into context when only a small subset is needed. ' +
      'Read-only; does not call any downstream tools itself.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description:
            'What you are trying to accomplish with Mushi, e.g. "fix the top bug", ' +
            '"check project health", "run QA tests", "set up Mushi". Leave blank for general orientation.',
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args, ctx) => {
      const intent = String(args.intent ?? '').toLowerCase()

      // Intent → curated tool subset (mirrors USE_MUSHI_INTENTS in catalog.ts).
      const INTENTS: Record<string, { label: string; tools: string[]; hint: string }> = {
        fix: {
          label: 'Fix a bug',
          tools: ['get_recent_reports', 'get_report', 'summarize_report_for_fix', 'dispatch_fix', 'start_skill_pipeline', 'checkin_pipeline_step', 'get_pipeline_run'],
          hint: 'Call get_recent_reports to find the top unresolved bug, then summarize_report_for_fix before dispatching.',
        },
        status: {
          label: 'Check project status',
          tools: ['get_dashboard', 'triage_next_steps', 'get_usage', 'get_backend_health', 'activation_status'],
          hint: 'Call triage_next_steps for a prioritised list of what to work on today.',
        },
        setup: {
          label: 'Set up Mushi',
          tools: ['mushi_setup', 'activation_status', 'get_backend_health', 'list_byok_keys', 'add_byok_key'],
          hint: 'Call mushi_setup first — it diagnoses setup gaps and returns the next command to run.',
        },
        qa: {
          label: 'Run / review QA tests',
          tools: ['list_qa_stories', 'run_qa_story', 'list_qa_story_runs', 'get_qa_story_run', 'list_pending_review_stories', 'approve_qa_story', 'improve_qa_story'],
          hint: 'Call list_qa_stories to see what test coverage exists; run_qa_story to trigger a run.',
        },
        pipeline: {
          label: 'Run an agent pipeline / skill',
          tools: ['list_skills', 'get_skill', 'start_skill_pipeline', 'checkin_pipeline_step', 'get_pipeline_run'],
          hint: 'Call list_skills to find the right skill, then start_skill_pipeline.',
        },
        audit: {
          label: 'Audit / health check',
          tools: ['run_fullstack_audit', 'get_backend_health', 'get_dashboard', 'get_usage'],
          hint: 'Call run_fullstack_audit for a full-stack health scorecard.',
        },
      }

      const matched = Object.entries(INTENTS).find(([key]) => intent.includes(key))
      const [, cluster] = matched ?? ['status', INTENTS['status']!]

      const projectLine = ctx.projectIdHint
        ? `Connected project: \`${ctx.projectIdHint}\`. `
        : 'No project configured — run `mushi_setup` to set MUSHI_PROJECT_ID. '

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
        'Tip: you can call any tool by name — `use_mushi` is read-only and never calls other tools itself. All tools remain available.',
      ].join('\n')

      return { content: [{ type: 'text', text: orientation }] }
    },
  },
}

/** Full catalog — base hand-authored tools + manifest-generated parity tools. */
let TOOLS: Record<string, ToolDef> = BASE_TOOLS

// ── Linear tools (added when the project has Linear credentials) ──────────────
//
// These proxy to Linear's remote MCP server (mcp.linear.app/mcp) using the
// project's vault-backed OAuth token. Guarded by "linear connected" check in
// the handler — returns a descriptive error if not connected.
//
// NOTE: imported lazily to avoid loading the module on cold starts when Linear
// is not used. We import at module-level here because Deno edge functions don't
// have lazy-require; the module is small and tree-shaken when unused.

/** Returns a handler that throws a clear error when Linear is not connected. */
const linearToolHandler = (
  toolName: string,
  buildArgs: (args: Record<string, unknown>) => Record<string, unknown>,
) => async (args: Record<string, unknown>, ctx: { authHeaders: Record<string, string>; projectIdHint?: string }) => {
  const projectId = ctx.projectIdHint
  if (!projectId) throw new Error('projectId is required for Linear tools. Set X-Mushi-Project header.')
  const db = getLinearServiceClient()
  const result = await callLinearMcpTool(db, projectId, toolName, buildArgs(args))
  if (result === null) {
    throw new Error('Linear is not connected for this project. Go to Integrations → Linear to connect your workspace.')
  }
  return result
}

const LINEAR_TOOLS: Record<string, ToolDef> = {
  linear_search_issues: {
    description: 'Search issues in the connected Linear workspace. Use this before creating a new issue to find duplicates.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (issue title, description, or identifier like ENG-123)' },
        teamId: { type: 'string', description: 'Optional Linear team ID to scope the search' },
      },
      required: ['query'],
    },
    scope: 'mcp:read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: linearToolHandler('linear_search_issues', (a) => ({ query: a.query, ...(a.teamId ? { teamId: a.teamId } : {}) })),
  },
  linear_get_issue: {
    description: 'Get a single Linear issue by identifier (e.g. "ENG-123"). Returns full issue details including description, state, and comments.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Linear issue identifier (e.g. "ENG-123") or internal ID' },
      },
      required: ['issueId'],
    },
    scope: 'mcp:read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: linearToolHandler('linear_get_issue', (a) => ({ issueId: a.issueId })),
  },
  linear_create_comment: {
    description: 'Post a comment on a Linear issue. Use to share fix progress, analysis results, or questions.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Linear issue identifier or ID' },
        body: { type: 'string', description: 'Markdown-formatted comment body' },
      },
      required: ['issueId', 'body'],
    },
    scope: 'mcp:write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    handler: linearToolHandler('linear_create_comment', (a) => ({ issueId: a.issueId, body: a.body })),
  },
  linear_update_issue_status: {
    description: 'Update the status/state of a Linear issue by state name (e.g. "In Progress", "Done", "Cancelled").',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Linear issue identifier or ID' },
        stateName: { type: 'string', description: 'Name of the target workflow state (e.g. "In Progress", "Done")' },
      },
      required: ['issueId', 'stateName'],
    },
    scope: 'mcp:write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    handler: linearToolHandler('linear_update_issue_status', (a) => ({ issueId: a.issueId, stateName: a.stateName })),
  },
  linear_create_issue: {
    description: 'Create a new issue in the connected Linear workspace. Use when no duplicate is found via linear_search_issues.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        description: { type: 'string', description: 'Issue description in Markdown' },
        teamId: { type: 'string', description: 'Target team ID (optional, uses project default)' },
        priority: { type: 'number', description: '0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low' },
      },
      required: ['title'],
    },
    scope: 'mcp:write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    handler: linearToolHandler('linear_create_issue', (a) => ({
      title: a.title,
      ...(a.description ? { description: a.description } : {}),
      ...(a.teamId ? { teamId: a.teamId } : {}),
      ...(a.priority !== undefined ? { priority: a.priority } : {}),
    })),
  },
}

TOOLS = { ...TOOLS, ...LINEAR_TOOLS }

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
  /** When `?read_only=1`, write tools are hidden and blocked even for mcp:write keys. */
  readOnlyMode: boolean
  /** When `?features=` is set, only tools in those groups are listed/callable. */
  features: FeatureFilter
  projectIdHint?: string
  requestId: string
  apiKeyId?: string
  ownerUserId?: string
}

function effectiveScope(ctx: CallContext): 'mcp:read' | 'mcp:write' | null {
  if (!ctx.scope) return null
  if (ctx.readOnlyMode && ctx.scope === 'mcp:write') return 'mcp:read'
  return ctx.scope
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
  const scope = effectiveScope(ctx)
  return {
    tools: Object.entries(TOOLS)
      .filter(([, def]) => isToolGrantedToScope(def.scope, scope))
      .filter(([name]) => toolMatchesFeatures(name, ctx.features))
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
  const started = Date.now()
  const name = params.name
  if (typeof name !== 'string') throw new McpError(ERR_INVALID_PARAMS, 'tools/call requires a string `name`')
  const def = TOOLS[name]
  if (!def) throw new McpError(ERR_METHOD_NOT_FOUND, `tool not found: ${name}`)
  if (!toolMatchesFeatures(name, ctx.features)) {
    throw new McpError(
      ERR_METHOD_NOT_FOUND,
      `tool "${name}" is not enabled for this connection — add its feature group to ?features= or use features=all`,
    )
  }
  // Scope gate. Anonymous clients (somehow past auth — shouldn't be
  // possible but defence in depth) get nothing. mcp:write implies read.
  const callerScope = effectiveScope(ctx)
  if (!callerScope) throw new McpError(ERR_INVALID_REQUEST, 'caller has no scope')
  if (!isToolGrantedToScope(def.scope, callerScope)) {
    throw new McpError(
      ERR_INVALID_REQUEST,
      `tool "${name}" requires ${def.scope} scope; caller holds ${callerScope}${ctx.readOnlyMode ? ' (read_only mode)' : ''}`,
    )
  }

  // Per-actor tools/call budget (production-readiness audit item #11): a
  // leaked mcp:write key could otherwise hammer dispatch_fix/merge_fix/etc.
  // unthrottled. Keyed on the API-key id when present, else the JWT-auth
  // user id — resolveAuth() always sets exactly one of the two.
  const rateLimitActorId = ctx.apiKeyId ?? ctx.ownerUserId
  if (rateLimitActorId) {
    const rateMiss = await claimMcpToolCallRateLimit(rateLimitActorId)
    if (rateMiss) {
      throw new McpError(
        ERR_RATE_LIMITED,
        `Rate limit exceeded: too many tool calls. Retry after ${rateMiss.retryAfterSeconds}s.`,
        { retryAfterSeconds: rateMiss.retryAfterSeconds },
      )
    }
  }

  const args = (params.arguments as Record<string, unknown> | undefined) ?? {}

  const recordOutcome = (status: 'ok' | 'error', errorCode?: string) => {
    void recordMcpToolInvocation({
      projectId: ctx.projectIdHint,
      apiKeyId: ctx.apiKeyId,
      toolName: name,
      scope: callerScope,
      transport: 'hosted',
      status,
      durationMs: Date.now() - started,
      requestId: ctx.requestId,
      args,
      errorCode,
      audit:
        status === 'ok' && def.scope === 'mcp:write' && ctx.ownerUserId && ctx.projectIdHint
          ? { actorId: ctx.ownerUserId, action: 'mcp.tool_called' }
          : undefined,
    })
  }

  try {
    const data = await def.handler(args, { authHeaders: ctx.authHeaders, projectIdHint: ctx.projectIdHint })
    recordOutcome('ok')
    // Modern clients read structuredContent directly (no re-parse). Older
    // clients fall back to the text content. Only emit structuredContent
    // when the tool defines an outputSchema AND the data is an object —
    // a bare array or scalar would fail downstream JSON-Schema validation.
    const includeStructured = !!def.outputSchema && typeof data === 'object' && data !== null
    // Prompt-injection mitigation: tools that return user-authored or
    // LLM-generated text are wrapped in data delimiters so adversarial
    // instructions inside them cannot override the agent's behaviour.
    const UNTRUSTED_TOOLS: ReadonlySet<string> = new Set([
      'get_report_detail',
      'get_fix_context',
      'search_reports',
      'get_similar_bugs',
      'run_nl_query',
      'query_lessons',
      'list_lessons',
    ])
    const text = UNTRUSTED_TOOLS.has(name)
      ? wrapUntrustedJson(data, name as string)
      : JSON.stringify(data, null, 2)
    const result: Record<string, unknown> = {
      content: [{ type: 'text', text }],
    }
    if (includeStructured) {
      result.structuredContent = data
    }
    return result
  } catch (err) {
    const errorCode =
      err instanceof McpError ? String(err.code)
      : err instanceof Error && err.message ? err.message.slice(0, 120)
      : 'INTERNAL'
    recordOutcome('error', errorCode)
    // Production-readiness audit item #13: a tool EXECUTION failure (bad
    // arguments a handler rejected, a downstream /v1/admin/* 4xx/5xx via
    // apiCall's ERR_UPSTREAM_HTTP, etc.) must be reported as a *successful*
    // tools/call result with `isError: true`, per spec — not re-thrown into
    // a top-level JSON-RPC error. A JSON-RPC error is for problems the tool
    // call itself can't fix (bad transport, unknown tool, insufficient
    // scope, rate limited — all of which throw earlier in this function,
    // outside this try block, and still surface as real JSON-RPC errors).
    // A tool-execution failure is exactly the kind of thing an LLM caller
    // should see the message for and retry with adjusted arguments — the
    // stdio transport gets this for free from the official MCP SDK's
    // `registerTool`; this hand-rolled hosted dispatcher has to do it
    // explicitly.
    const message = err instanceof McpError ? err.message : err instanceof Error ? err.message : String(err)
    const errorPayload: Record<string, unknown> = { error: message }
    if (err instanceof McpError) {
      errorPayload.code = err.code
      if (err.data !== undefined) errorPayload.data = err.data
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
      isError: true,
    }
  }
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
    throw new McpError(ERR_INVALID_PARAMS, 'inventory://current requires a project context; set X-Mushi-Project-Id header or pass projectId')
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

TOOLS = {
  ...BASE_TOOLS,
  ...buildManifestTools({
    apiCall,
    requireString,
    McpError,
    ERR_INVALID_PARAMS,
  }),
}

// ── Deprecated-alias backward-compatibility shims ──────────────────────────
// Old tool names resolve for ONE release so existing agent configs don't break
// silently on upgrade. Shims are hidden from tools/list filtering — handled by
// toolMatchesFeatures returning true (unknown names pass through) — and they
// are callable but inject a deprecation notice into the response.
for (const [oldName, newName] of Object.entries(DEPRECATED_TOOL_ALIASES)) {
  const target = TOOLS[newName]
  if (!target) continue // target may not be in this transport build
  TOOLS[oldName] = {
    ...target,
    description:
      `⚠️ DEPRECATED — use \`${newName}\` instead. This alias will be removed in the next release.\n\n${target.description}`,
    handler: async (args, ctx) => {
      const data = await target.handler(args, ctx)
      // If the result is an object, inject a deprecation key so callers notice.
      if (data != null && typeof data === 'object' && !Array.isArray(data)) {
        return {
          _deprecated: `Tool \`${oldName}\` was renamed to \`${newName}\`. Update your agent config — alias removed next release.`,
          ...(data as Record<string, unknown>),
        }
      }
      return data
    },
  }
}

// ----------------------------------------------------------------------------
// Auth — dual mode (API key OR JWT). Validates the key against
// `project_api_keys` via service-role; for JWT we rely on the downstream
// `api` function's `jwtAuth` to do the heavy lifting (we just check the
// header is present so we can refuse unauth at the MCP edge).
// ----------------------------------------------------------------------------

async function resolveAuth(req: Request, requestId: string): Promise<CallContext> {
  const url = new URL(req.url)
  const readOnlyMode = url.searchParams.get('read_only') === '1'
  const features = parseFeaturesParam(url.searchParams.get('features'))
  // Project API keys arrive as X-Mushi-Api-Key (legacy configs) OR as an
  // OAuth bearer token — the token minted by the /oauth flow IS a `mushi_`
  // project API key, so both take the same validation path below.
  const rawAuth = req.headers.get('Authorization')
  const bearerToken = rawAuth?.startsWith('Bearer ') ? rawAuth.slice('Bearer '.length).trim() : null
  const apiKey =
    req.headers.get('X-Mushi-Api-Key') ??
    (bearerToken?.startsWith('mushi_') ? bearerToken : null)
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
      `${supabaseUrl}/rest/v1/project_api_keys?key_hash=eq.${encodeURIComponent(keyHash)}&is_active=eq.true&select=project_id,scopes,owner_user_id,id`,
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
      id: string
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
      authHeaders: propagateRequestId(
        {
          'X-Mushi-Api-Key': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'X-Mushi-Project-Id': row.project_id,
        },
        requestId,
      ),
      scope,
      readOnlyMode,
      features,
      projectIdHint: row.project_id,
      requestId,
      apiKeyId: row.id,
      ownerUserId: row.owner_user_id ?? undefined,
    }
  }

  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim()
    if (!token) {
      throw new McpError(ERR_INVALID_REQUEST, 'Authentication required: Bearer token is empty')
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) {
      throw new McpError(ERR_INTERNAL, 'Server not configured for JWT auth')
    }
    // Security fix (production-readiness audit): previously ANY string
    // after "Bearer " was assigned scope: 'mcp:write' with zero local
    // validation, on the theory that a bad JWT would fail closed once a
    // tool fanned out to /v1/admin/*. That reasoning breaks for
    // `tools/list`, which never makes a downstream call — so the full
    // write-tool catalog (schemas for merge_fix, dispatch_fix,
    // award_bonus_points, etc.) leaked to any caller who sent garbage in
    // the Authorization header. This is the MCP "token passthrough"
    // anti-pattern OWASP/Tyk explicitly warn against. A single GoTrue
    // round-trip confirms the token is a real, unexpired Supabase session
    // before any scope is granted; unvalidated bearer tokens now get no
    // scope instead of the implicit superset.
    let userRes: Response
    try {
      userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: auth },
      })
    } catch {
      throw new McpError(ERR_INVALID_REQUEST, 'Invalid or expired auth token')
    }
    if (!userRes.ok) {
      throw new McpError(ERR_INVALID_REQUEST, 'Invalid or expired auth token')
    }
    const user = (await userRes.json().catch(() => null)) as { id?: string } | null
    if (!user?.id) {
      throw new McpError(ERR_INVALID_REQUEST, 'Invalid or expired auth token')
    }
    return {
      authHeaders: propagateRequestId({ Authorization: auth }, requestId),
      scope: 'mcp:write',
      readOnlyMode,
      features,
      requestId,
      ownerUserId: user.id,
    }
  }

  throw new McpError(
    ERR_INVALID_REQUEST,
    'Authentication required: log in via OAuth (`claude mcp login mushi` / your client\'s MCP login), or send X-Mushi-Api-Key / Authorization: Bearer <mushi_ API key or console JWT>',
  )
}

// ----------------------------------------------------------------------------
// HTTP entry — Streamable HTTP per MCP 2025-03-26
// ----------------------------------------------------------------------------

const ALLOWED_METHODS = 'GET, HEAD, POST, DELETE, OPTIONS'

const SMITHERY_SCANNER_TOKEN_DEFAULT = 'mushi-smithery-publisher-scan'

function smitheryScannerToken(): string {
  return Deno.env.get('MCP_SMITHERY_SCAN_TOKEN') || SMITHERY_SCANNER_TOKEN_DEFAULT
}

/**
 * Security fix (production-readiness audit): this previously matched on a
 * client-controlled `User-Agent` header (`/smithery/i`), which is trivially
 * spoofable — any caller could claim to be the Smithery scanner in its UA
 * string and get an unauthenticated catalog probe. We now require the
 * caller to present the exact bearer token minted by
 * `buildSmitheryTokenResponse()` (the OAuth stub Smithery's verifier
 * actually completes), so scanning still requires the handshake instead of
 * an unverifiable header claim. The token is env-overridable
 * (`MCP_SMITHERY_SCAN_TOKEN`) so it can be rotated without a code change if
 * it ever leaks.
 */
function isSmitheryScanner(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
  return token.length > 0 && token === smitheryScannerToken()
}

/**
 * Publisher scan uses the stubbed OAuth token to probe the catalog.
 * Scope is deliberately capped at `mcp:read` — even though the OAuth stub
 * token nominally advertises `mcp:read mcp:write`, granting write scope
 * here would disclose full JSON schemas for destructive tools (merge_fix,
 * dispatch_fix, award_bonus_points, ...) to an unauthenticated directory
 * crawler. Smithery only needs to confirm the server exists and has tools,
 * not see the mutating tool surface — same principle as a real mcp:read
 * API key.
 */
function smitheryScannerContext(requestId: string): CallContext {
  return {
    authHeaders: {},
    scope: 'mcp:read',
    readOnlyMode: true,
    features: 'all',
    requestId,
  }
}

async function trySmitheryScannerPost(req: Request, payload: unknown): Promise<Response | null> {
  if (!isSmitheryScanner(req)) return null
  const requestId = req.headers.get('x-request-id')?.trim() || crypto.randomUUID().slice(0, 12)
  const ctx = smitheryScannerContext(requestId)

  if (Array.isArray(payload)) {
    const responses: Array<JsonRpcSuccess | JsonRpcError> = []
    for (const entry of payload) {
      const rpc = entry as JsonRpcRequest
      if (!rpc || typeof rpc !== 'object' || rpc.method === 'notifications/initialized' || rpc.method === 'initialized') {
        continue
      }
      const allowed = rpc.method === 'initialize' || rpc.method === 'tools/list' || rpc.method === 'ping'
      if (!allowed) continue
      const r = await dispatchRpc(rpc, ctx)
      if (r) responses.push(r)
    }
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS })
    return jsonRpcResponse(responses)
  }

  const rpc = payload as JsonRpcRequest
  if (!rpc || typeof rpc !== 'object' || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return null
  }
  if (rpc.method === 'notifications/initialized' || rpc.method === 'initialized') {
    return new Response(null, { status: 202, headers: CORS_HEADERS })
  }
  if (rpc.method !== 'initialize' && rpc.method !== 'tools/list' && rpc.method !== 'ping') {
    return null
  }
  const response = await dispatchRpc(rpc, ctx)
  if (!response) return new Response(null, { status: 202, headers: CORS_HEADERS })
  const extraHeaders: Record<string, string> = {}
  if (rpc.method === 'tools/list') extraHeaders['Cache-Control'] = 'private, max-age=300'
  return jsonRpcResponse(response, extraHeaders)
}

function jsonResponse(
  body: string,
  status: number,
  headers: Record<string, string>,
  method: string,
): Response {
  // Smithery publisher scan uses HEAD for RFC 8414 AS discovery — include JSON body.
  return new Response(body, { status, headers })
}

function oauthOperationalPath(pathname: string): boolean {
  if (pathname.includes('/oauth/authorize')) return false
  return (
    pathname.includes('/oauth/') &&
    !pathname.includes('oauth-authorization-server') &&
    !pathname.includes('oauth-protected-resource')
  )
}
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': ALLOWED_METHODS,
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Mushi-Api-Key, X-Mushi-Project-Id, MCP-Session-Id, MCP-Protocol-Version',
  'Access-Control-Max-Age': '600',
}

/**
 * Forward an /oauth/register or /oauth/token POST to the real OAuth
 * implementation in the api function (api/routes/mcp-oauth.ts). The client
 * IP is forwarded so the api-side per-IP rate limits key on the caller, not
 * on this function's egress address.
 */
async function proxyMcpOauthPost(
  req: Request,
  endpoint: 'register' | 'token',
  body: string,
  contentType: string,
): Promise<Response> {
  const supabaseOrigin = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  if (!supabaseOrigin) {
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: 'Server not configured for OAuth (SUPABASE_URL missing)' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    )
  }
  const headers: Record<string, string> = { 'Content-Type': contentType }
  // Rate-limit identity for the api side. cf-connecting-ip is set by the
  // platform and cannot be spoofed by the caller. The X-Forwarded-For
  // fallback (non-Cloudflare self-hosts) takes the RIGHTMOST hop: each proxy
  // appends the peer it actually saw, so the last entry is the only one the
  // client cannot fabricate. Leftmost is fully attacker-controlled and would
  // let a client rotate past the register/token throttles.
  const xff = req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean)
  const callerIp = req.headers.get('cf-connecting-ip') ?? (xff && xff[xff.length - 1])
  if (callerIp) headers['X-Forwarded-For'] = callerIp
  try {
    const res = await fetch(`${supabaseOrigin}/functions/v1/api/v1/mcp-oauth/${endpoint}`, {
      method: 'POST',
      headers,
      body,
    })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS,
      },
    })
  } catch {
    return new Response(
      JSON.stringify({ error: 'temporarily_unavailable', error_description: 'OAuth backend unreachable — try again shortly' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    )
  }
}

function unauthorizedJsonRpc(req: Request, message: string, code = ERR_INVALID_REQUEST): Response {
  const metadataUrl = mcpProtectedResourceMetadataUrl(new URL(req.url))
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': bearerWwwAuthenticateResourceMetadata(metadataUrl),
        ...CORS_HEADERS,
      },
    },
  )
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // Spec metadata GET/HEAD (without Accept: text/event-stream) — return the
  // MCP server descriptor so curl-style probes can confirm the endpoint
  // is alive without negotiating SSE. Smithery OAuth discovery uses HEAD.
  if (req.method === 'GET' || req.method === 'HEAD') {
    const url = new URL(req.url)
    if (url.pathname.includes('server-card.json')) {
      const card = JSON.stringify(buildMcpServerCard(), null, 2)
      return jsonResponse(
        card,
        200,
        { ...MCP_SERVER_CARD_HEADERS, ...CORS_HEADERS },
        req.method,
      )
    }
    if (url.pathname.includes('oauth-protected-resource')) {
      const metadata = buildOAuthProtectedResourceMetadata(url)
      return jsonResponse(metadata, 200, { ...MCP_OAUTH_METADATA_HEADERS, ...CORS_HEADERS }, req.method)
    }
    if (
      url.pathname.includes('oauth-authorization-server') ||
      url.pathname.includes('openid-configuration')
    ) {
      const metadata = buildOAuthAuthorizationServerMetadata(url)
      return jsonResponse(metadata, 200, { ...MCP_OAUTH_AS_METADATA_HEADERS, ...CORS_HEADERS }, req.method)
    }
    if (url.pathname.includes('/oauth/authorize')) {
      // Smithery publisher scan short-circuits to the stub; every real MCP
      // client (claude mcp login, Cursor, …) is handed to the api function's
      // OAuth authorize endpoint, which validates the request and 302s to
      // the console consent page.
      const smitheryRedirect = buildSmitheryAuthorizeRedirect(url)
      if (smitheryRedirect) return smitheryRedirect
      const supabaseOrigin = (Deno.env.get('SUPABASE_URL') ?? url.origin).replace(/\/+$/, '')
      const target = new URL(`${supabaseOrigin}/functions/v1/api/v1/mcp-oauth/authorize`)
      url.searchParams.forEach((v, k) => target.searchParams.set(k, v))
      return new Response(null, {
        status: 302,
        headers: { Location: target.toString(), ...CORS_HEADERS },
      })
    }
    if (oauthOperationalPath(url.pathname)) {
      return jsonResponse(
        JSON.stringify({
          error: 'method_not_allowed',
          error_description: 'OAuth register/token endpoints require POST',
        }),
        405,
        { 'Content-Type': 'application/json', ...CORS_HEADERS },
        req.method,
      )
    }
    const iconParam = url.searchParams.get('icon')
    if (iconParam === '1' || iconParam === 'svg') {
      return jsonResponse(MUSHI_ICON_SVG_INLINE, 200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
        ...CORS_HEADERS,
      }, req.method)
    }
    const accept = req.headers.get('Accept') ?? ''
    if (!accept.includes('text/event-stream')) {
      // RFC 9728: OAuth clients (Smithery setup) GET the resource URL and expect
      // Protected Resource Metadata — not the SEP-1649 server card. Server card
      // lives at `/.well-known/mcp/server-card.json`.
      const metadata = buildOAuthProtectedResourceMetadata(url)
      return jsonResponse(metadata, 200, { ...MCP_OAUTH_METADATA_HEADERS, ...CORS_HEADERS }, req.method)
    }
    // Auth + open SSE. We have no server-initiated messages today; emit
    // heartbeats so proxies don't kill the connection and the client
    // reconnect logic stays warm. If a future feature adds notifications
    // (resource changes, dispatch progress) it streams down this pipe.
    let ctx: CallContext
    try {
      const requestId = req.headers.get('x-request-id')?.trim() || crypto.randomUUID().slice(0, 12)
      ctx = await resolveAuth(req, requestId)
    } catch (err) {
      const e = err as McpError
      return unauthorizedJsonRpc(req, e.message, e.code)
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

  const url = new URL(req.url)
  if (url.pathname.includes('/oauth/token')) {
    const params = await readOAuthParams(req)
    // Smithery scanner codes (`mushi-scan-…`) / client_credentials keep the
    // stub; real authorization codes exchange against the api function.
    const scanToken = buildSmitheryTokenResponse(params)
    if (scanToken) {
      return new Response(scanToken.body, {
        status: scanToken.status,
        headers: { ...Object.fromEntries(scanToken.headers), ...CORS_HEADERS },
      })
    }
    const form = new URLSearchParams()
    params.forEach((v, k) => form.set(k, v))
    return proxyMcpOauthPost(req, 'token', form.toString(), 'application/x-www-form-urlencoded')
  }
  // RFC 7591 dynamic client registration. The Smithery publisher scan
  // (smithery-only redirect URIs) keeps its deterministic stub client;
  // everything else registers for real via the api function.
  if (url.pathname.includes('/oauth/register')) {
    const bodyText = await req.text()
    let smitheryOnly = false
    try {
      const parsed = JSON.parse(bodyText) as { redirect_uris?: unknown }
      const uris = Array.isArray(parsed.redirect_uris) ? parsed.redirect_uris : []
      smitheryOnly =
        uris.length > 0 && uris.every((u) => typeof u === 'string' && isSmitheryRedirectUri(u))
    } catch { /* malformed body → let the real endpoint reject it */ }
    if (smitheryOnly) {
      return new Response(
        JSON.stringify({
          client_id: 'mushi-hosted-mcp-smithery',
          token_endpoint_auth_method: 'none',
          client_id_issued_at: Math.floor(Date.now() / 1000),
          grant_types: ['authorization_code', 'client_credentials'],
          response_types: ['code'],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      )
    }
    return proxyMcpOauthPost(req, 'register', bodyText, 'application/json')
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonRpcResponse({ jsonrpc: '2.0', id: null, error: { code: ERR_PARSE, message: 'Invalid JSON' } })
  }

  const scannerResponse = await trySmitheryScannerPost(req, payload)
  if (scannerResponse) return scannerResponse

  const requestId = req.headers.get('x-request-id')?.trim() || crypto.randomUUID().slice(0, 12)
  let ctx: CallContext
  try {
    ctx = await resolveAuth(req, requestId)
  } catch (err) {
    const e = err as McpError
    return unauthorizedJsonRpc(req, e.message, e.code)
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

  // Capture window start before dispatch so the window boundary is consistent
  // even when the tool call itself takes many milliseconds.
  const windowStartSec = Math.floor(Date.now() / 1000 / 60) * 60

  const response = await dispatchRpc(rpc, ctx)
  if (!response) {
    // Notification — no response.
    return new Response(null, { status: 202, headers: CORS_HEADERS })
  }
  const extraHeaders: Record<string, string> = {}
  if (rpc.method === 'tools/list') {
    extraHeaders['Cache-Control'] = 'private, max-age=300'
  }
  // Add X-RateLimit-* headers on tools/call responses so agents can self-throttle.
  // Detect a rate-limit miss by the JSON-RPC error code (ERR_RATE_LIMITED = -32001).
  if (rpc.method === 'tools/call') {
    const isMiss =
      typeof response === 'object' &&
      response !== null &&
      'error' in response &&
      (response as { error?: { code?: number } }).error?.code === ERR_RATE_LIMITED
    Object.assign(extraHeaders, buildRateLimitHeaders({ scope: 'tools_call', isMiss, windowStartSec }))
  }
  return jsonRpcResponse(response, extraHeaders)
}

function jsonRpcResponse(body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extraHeaders, ...CORS_HEADERS },
  })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('mcp', handler))
}
