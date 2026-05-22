/**
 * FILE: packages/server/supabase/functions/api/routes/openapi.ts
 *
 * /openapi.json — OpenAPI 3.1 specification of the public Mushi REST surface.
 *
 * Why this file exists
 * ────────────────────
 * The agent card at `/.well-known/agent-card` advertises
 * `transports.rest.openapi: <api>/openapi.json`, but the route was never
 * registered. Every external orchestrator following the discovery doc
 * (LangGraph code-gen, generic OpenAPI clients, A2A skill negotiators)
 * hit a 404 and was forced to hand-author a Mushi client per integration.
 *
 * Scope
 * ─────
 * Hand-curated, narrow on purpose. We document the endpoints that
 * external orchestrators actually use:
 *
 *   - /v1/admin/fixes/dispatch (POST + GET stream + cancel)
 *   - /v1/admin/reports (list + detail + similarity)
 *   - /v1/admin/inventory/{id} (snapshot + findings + diff)
 *   - /v1/a2a/tasks (create / get / cancel / subscribe — A2A v1.0.0)
 *   - /v1/admin/auth/token (refresh / introspect — RFC 6749)
 *
 * Internal admin-only endpoints (settings forms, billing, super-admin
 * diagnostics) are deliberately excluded — they're shaped for the
 * Mushi admin UI, not for general-purpose API clients, and would
 * mislead external code-gen.
 *
 * Why hand-authored vs. generated
 * ───────────────────────────────
 * Hono doesn't ship a runtime OpenAPI generator that's stable on Deno
 * Edge today. The few generators that exist (hono-openapi, zod-to-openapi)
 * either need build-time codegen or pull in a transitive surface ~5x
 * the size of this module. The endpoint count is small and stable, so
 * the maintenance cost of keeping this file in sync is lower than the
 * dependency cost. New endpoints get a paragraph here; CI doesn't fail
 * if an admin-only endpoint is missing because admin endpoints aren't
 * in the contract.
 */

import type { Hono } from 'npm:hono@4'

const OPENAPI_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  // Cache aggressively — the spec only changes when this file does, and
  // the build deploys it deterministically. 5 min is short enough that a
  // mid-day point release reaches consumers within the next refresh.
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  'Access-Control-Allow-Origin': '*',
}

export function registerOpenApiRoute(app: Hono<any>): void {
  app.get('/openapi.json', (c) => {
    const url = new URL(c.req.raw.url)
    const apiBase = `${url.protocol}//${url.host}/functions/v1/api`
    return new Response(JSON.stringify(buildSpec(apiBase), null, 2), {
      status: 200,
      headers: OPENAPI_HEADERS,
    })
  })

  // Backwards-compat alias under /v1 — the agent card has historically
  // referenced `${apiBase}/openapi.json` (so /functions/v1/api/openapi.json),
  // and that's the canonical location. Some clients hard-code /v1/openapi.json.
  app.get('/v1/openapi.json', (c) => {
    const url = new URL(c.req.raw.url)
    const apiBase = `${url.protocol}//${url.host}/functions/v1/api`
    return new Response(JSON.stringify(buildSpec(apiBase), null, 2), {
      status: 200,
      headers: OPENAPI_HEADERS,
    })
  })
}

function buildSpec(apiBase: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Mushi Mushi REST API',
      version: '2.0.0',
      summary:
        'Public REST surface for the Mushi Mushi autofix platform. Pair with the MCP transport at /functions/v1/mcp for richer agent flows.',
      description:
        'Documents the endpoints external orchestrators (LangGraph, OpenAI Agents SDK, CrewAI, A2A agents) ' +
        'are expected to call. Internal admin-UI-only endpoints (settings forms, billing) are intentionally ' +
        'omitted — see /.well-known/agent-card for the discovery doc that advertises this spec.',
      contact: { name: 'Mushi Mushi', url: 'https://mushimushi.dev' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [{ url: apiBase }],
    components: {
      securitySchemes: {
        mushiApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Mushi-Api-Key',
          description: 'Per-project API key with mcp:read or mcp:write scope.',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase-issued JWT for project owner / org member.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            ok: { type: 'boolean' },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        DispatchRequest: {
          type: 'object',
          required: ['reportId', 'projectId'],
          properties: {
            reportId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            inventoryActionNodeId: {
              type: 'string',
              format: 'uuid',
              description:
                'Optional spec-traceability anchor (whitepaper §2.10). When supplied, the worker skips the graph walk to recover the inventory Action and includes its expected_outcome contract verbatim in the LLM prompt.',
            },
          },
        },
        DispatchResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                dispatchId: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'skipped'] },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        A2ATask: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string', const: 'task' },
            state: {
              type: 'string',
              enum: ['submitted', 'working', 'completed', 'failed', 'canceled', 'unknown'],
            },
            skill: { type: 'string', example: 'dispatch_fix' },
            submittedAt: { type: 'string', format: 'date-time' },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            error: { type: 'string', nullable: true },
            artifacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  mimeType: { type: 'string' },
                  url: { type: 'string', format: 'uri' },
                },
              },
            },
            metadata: {
              type: 'object',
              properties: {
                projectId: { type: 'string', format: 'uuid' },
                reportId: { type: 'string', format: 'uuid' },
                fixAttemptId: { type: 'string', format: 'uuid', nullable: true },
                inventoryActionNodeId: { type: 'string', format: 'uuid', nullable: true },
              },
            },
          },
        },
        A2ATaskCreateRequest: {
          type: 'object',
          required: ['skill', 'input'],
          properties: {
            skill: { type: 'string', enum: ['dispatch_fix'] },
            input: {
              type: 'object',
              required: ['reportId'],
              properties: {
                reportId: { type: 'string', format: 'uuid' },
                projectId: { type: 'string', format: 'uuid' },
                inventoryActionNodeId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
    },
    security: [{ mushiApiKey: [] }, { bearerAuth: [] }],
    paths: {
      '/v1/admin/fixes/dispatch': {
        post: {
          summary: 'Dispatch a fix attempt',
          description:
            'Dispatch the agentic fix orchestrator for a classified report. Returns immediately with a dispatchId; subscribe to /v1/admin/fixes/dispatch/{id}/stream for live AG-UI v0.4 events.',
          operationId: 'dispatchFix',
          tags: ['fixes'],
          security: [{ mushiApiKey: ['mcp:write'] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DispatchRequest' } },
            },
          },
          responses: {
            '200': {
              description: 'Dispatched (or already running)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/DispatchResponse' } } },
            },
            '400': { description: 'Bad input', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '409': { description: 'Already dispatched', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/admin/fixes/dispatch/{id}': {
        get: {
          summary: 'Get fix dispatch state',
          operationId: 'getFixDispatch',
          tags: ['fixes'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Dispatch row' }, '404': { description: 'Not found' } },
        },
      },
      '/v1/admin/fixes/dispatch/{id}/stream': {
        get: {
          summary: 'Subscribe to AG-UI v0.4 fix dispatch events',
          description:
            'SSE stream of run.started, run.status, run.completed, run.failed events shaped per the AG-UI v0.4 protocol envelope. Auth is dual-mode (API key with mcp:read OR JWT) — see 2026-05-09 audit.',
          operationId: 'streamFixDispatch',
          tags: ['fixes'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              description: 'SSE stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/v1/admin/fixes/dispatches/{id}/cancel': {
        post: {
          summary: 'Cancel a fix dispatch',
          operationId: 'cancelFixDispatch',
          tags: ['fixes'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Cancelled' }, '409': { description: 'Already terminal' } },
        },
      },
      '/v1/admin/reports': {
        get: {
          summary: 'List recent reports',
          operationId: 'listReports',
          tags: ['reports'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'severity', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          ],
          responses: { '200': { description: 'Report list' } },
        },
      },
      '/v1/admin/reports/{id}': {
        get: {
          summary: 'Get a single report',
          operationId: 'getReport',
          tags: ['reports'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Report detail' }, '404': { description: 'Not found' } },
        },
      },
      '/v1/admin/inventory/{projectId}': {
        get: {
          summary: 'Current inventory.yaml snapshot',
          operationId: 'getInventory',
          tags: ['inventory'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Snapshot' } },
        },
      },
      '/v1/admin/inventory/{projectId}/findings': {
        get: {
          summary: 'Latest gate findings (5-gate composite)',
          operationId: 'getInventoryFindings',
          tags: ['inventory'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'gate', in: 'query', schema: { type: 'string' } },
            { name: 'severity', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Findings' } },
        },
      },
      '/v1/a2a/tasks': {
        post: {
          summary: 'A2A v1.0.0 — create a Task',
          description:
            'Create an A2A Task (skill=dispatch_fix). Backed by the same fix_dispatch_jobs row the legacy /v1/admin/fixes/dispatch creates — the response is the A2A Task representation of that row.',
          operationId: 'a2aCreateTask',
          tags: ['a2a'],
          security: [{ mushiApiKey: ['mcp:write'] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/A2ATaskCreateRequest' } } },
          },
          responses: {
            '201': { description: 'Task created', content: { 'application/json': { schema: { $ref: '#/components/schemas/A2ATask' } } } },
            '400': { description: 'Bad input' },
            '409': { description: 'Already running' },
          },
        },
      },
      '/v1/a2a/tasks/{id}': {
        get: {
          summary: 'A2A v1.0.0 — get Task state',
          operationId: 'a2aGetTask',
          tags: ['a2a'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'Task', content: { 'application/json': { schema: { $ref: '#/components/schemas/A2ATask' } } } },
            '404': { description: 'Not found' },
          },
        },
      },
      '/v1/a2a/tasks/{id}:cancel': {
        post: {
          summary: 'A2A v1.0.0 — cancel Task',
          operationId: 'a2aCancelTask',
          tags: ['a2a'],
          security: [{ mushiApiKey: ['mcp:write'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Cancelled' }, '409': { description: 'Already terminal' } },
        },
      },
      '/v1/a2a/tasks/{id}:subscribe': {
        get: {
          summary: 'A2A v1.0.0 — subscribe to Task events (SSE)',
          operationId: 'a2aSubscribeTask',
          tags: ['a2a'],
          security: [{ mushiApiKey: ['mcp:read'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              description: 'SSE stream of task.updated / task.terminal events',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/v1/admin/auth/token': {
        post: {
          summary: 'RFC 6749 token endpoint (refresh + introspection)',
          operationId: 'authToken',
          tags: ['auth'],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    grant_type: { type: 'string', enum: ['refresh_token'] },
                    refresh_token: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Token bundle or introspection result' } },
        },
      },
    },
    'x-mushi-extensions': {
      mcp: {
        endpoint: '/functions/v1/mcp',
        protocolVersions: ['2025-03-26', '2024-11-05'],
        description:
          'JSON-RPC 2.0 over Streamable HTTP. Use this for tool-call-shaped agent flows; the REST surface above is for direct CRUD.',
      },
      a2a: {
        agentCard: '/.well-known/agent-card',
        protocolVersion: '1.0.0',
      },
      schemas: {
        inventory: 'https://mushimushi.dev/schemas/inventory-2.0.json',
        fixContext: `${apiBase}/v1/schemas/fix-context.json`,
        fixResult: `${apiBase}/v1/schemas/fix-result.json`,
        sandboxProvider: `${apiBase}/v1/schemas/sandbox-provider.json`,
        expectedOutcome: `${apiBase}/v1/schemas/expected-outcome.json`,
      },
    },
  }
}
