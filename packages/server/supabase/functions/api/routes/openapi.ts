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
 * integrators and external orchestrators actually use:
 *
 *   - SDK-less ingest: /v1/reports (single + batch + status + by-trace),
 *     /v1/ingest/spans, /v1/ingest/metrics, /v1/sdk/config, /v1/health.
 *     The report body schema mirrors BOTH validators the route runs
 *     (ApiReportBodySchema in _shared/validate.ts, then reportSubmissionSchema
 *     in _shared/schemas.ts inside ingestReport); openapi-spec.test.ts keeps
 *     the required lists in step with the Zod shapes.
 *   - The CLI/MCP read mirror /v1/sync/* (API key with mcp:read / mcp:write)
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

import { PUBLIC_CORS_HEADERS } from '../../_shared/cors.ts'
import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { API_ERROR_CODES } from '../../_shared/error-codes.ts'
import { REPORT_CATEGORY_UNION } from '../../_shared/report-category.ts'

/**
 * A request body that passes both report validators — the same minimal body
 * `mushi test` sends (packages/cli/src/commands/diagnostics.ts). The docs
 * curl quickstart (apps/docs/content/quickstart/http-api.mdx) uses it too.
 */
export const REPORT_REQUEST_EXAMPLE = {
  projectId: 'YOUR_PROJECT_ID',
  category: 'bug',
  description: 'The Save button on the settings page does nothing.',
  reporterToken: 'curl-test-1',
  createdAt: '2026-11-18T09:00:00.000Z',
  environment: {
    url: 'https://example.com/settings',
    userAgent: 'curl/8',
    platform: 'server',
    language: 'en',
    viewport: { width: 0, height: 0 },
    referrer: '',
    timestamp: '2026-11-18T09:00:00.000Z',
    timezone: 'UTC',
  },
} as const

const OPENAPI_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  // Cache aggressively — the spec only changes when this file does, and
  // the build deploys it deterministically. 5 min is short enough that a
  // mid-day point release reaches consumers within the next refresh.
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  ...PUBLIC_CORS_HEADERS,
}

export function registerOpenApiRoute(app: Hono<{ Variables: Variables }>): void {
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
        'Documents the endpoints an integrator needs without an SDK (file a report with one POST /v1/reports, ' +
        'read reports back over /v1/sync/*) and the ones external orchestrators (LangGraph, OpenAI Agents SDK, ' +
        'CrewAI, A2A agents) are expected to call. Get a key: run `npx mushi-mushi` (it signs you in and writes ' +
        'the SDK key, scope report:write) or mint one in the console under Manage apps. Internal ' +
        'admin-UI-only endpoints (settings forms, billing) are intentionally omitted — see ' +
        '/.well-known/agent-card for the discovery doc that advertises this spec.',
      contact: { name: 'Mushi Mushi', url: 'https://kensaur.us/mushi-mushi' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [{ url: apiBase }],
    components: {
      headers: {
        RetryAfter: {
          description: 'Seconds to wait before retrying.',
          schema: { type: 'integer', minimum: 1 },
        },
      },
      responses: {
        Unauthorized: {
          description: 'MISSING_API_KEY (no X-Mushi-Api-Key header) or INVALID_API_KEY (unknown or revoked key).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ForbiddenKey: {
          description:
            'INSUFFICIENT_SCOPE (the key lacks the scope this route needs), KEY_EXPOSED_IN_BROWSER (an mcp:* key was seen in a browser), or an org-scoped account key on an ingest route.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'RATE_LIMITED. Wait for Retry-After seconds, then retry.',
          headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        QuotaExceeded: {
          description: 'QUOTA_EXCEEDED: the plan’s monthly report quota is used up. Retry-After says when to try again.',
          headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/QuotaExceededError' } } },
        },
      },
      securitySchemes: {
        mushiApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Mushi-Api-Key',
          description:
            'Per-project API key. Scopes: report:write (the public SDK key; safe in a browser bundle; ingest routes only), ' +
            'mcp:read (read reports, /v1/sync/*), mcp:write (implies mcp:read; reply, dispatch fixes). voice:write, ' +
            'runner:write and ops:write keys reach only their own routes. Org-scoped account keys are refused on ingest (403).',
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
            ok: { type: 'boolean', description: 'Always false on error envelopes.' },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: {
                  type: 'string',
                  enum: [...API_ERROR_CODES],
                  description:
                    'Stable machine-readable code from packages/server/supabase/functions/_shared/error-codes.ts. Prefer this over parsing `message`.',
                },
                message: {
                  type: 'string',
                  description: 'Human-safe message. Never contains Postgres / stack / secret detail.',
                },
                requestId: {
                  type: 'string',
                  description:
                    'Correlation id echoed from X-Request-Id. Quote this when reporting a bug — it links console, Sentry, and Langfuse.',
                },
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
        // ── SDK-less ingest ────────────────────────────────────────────────
        ValidationError: {
          type: 'object',
          description: 'The first validator’s 400 (ApiReportBodySchema). Note `error` is a string here, not an object.',
          required: ['error', 'message', 'fields'],
          properties: {
            error: { type: 'string', const: 'VALIDATION_ERROR' },
            message: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                required: ['path', 'message'],
                properties: { path: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
        },
        IngestError: {
          type: 'object',
          description:
            'Ingest-specific 400/413 envelope. Codes: INGEST_ERROR (the full report schema rejected the body; message names the field, e.g. "environment.timezone: Required"), PROJECT_MISMATCH (body projectId is not the key’s project), INVALID_JSON, INVALID_PAYLOAD, SPAN_TOO_LARGE.',
          required: ['ok', 'error'],
          properties: {
            ok: { type: 'boolean', const: false },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
        QuotaExceededError: {
          type: 'object',
          required: ['ok', 'error'],
          properties: {
            ok: { type: 'boolean', const: false },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', const: 'QUOTA_EXCEEDED' },
                message: { type: 'string' },
                used: { type: 'integer' },
                limit: { type: ['integer', 'null'] },
                periodResetsAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        ReportEnvironment: {
          type: 'object',
          description: 'Where the report came from. Every listed field is required; send "" or 0 when you have no value. Extra keys are kept.',
          required: ['url', 'userAgent', 'platform', 'language', 'viewport', 'referrer', 'timestamp', 'timezone'],
          additionalProperties: true,
          properties: {
            url: { type: 'string', description: 'Page or screen the user was on.' },
            userAgent: { type: 'string' },
            platform: { type: 'string' },
            language: { type: 'string', example: 'en' },
            viewport: {
              type: 'object',
              required: ['width', 'height'],
              properties: { width: { type: 'number' }, height: { type: 'number' } },
            },
            referrer: { type: 'string' },
            timestamp: { type: 'string', description: 'ISO 8601 time the report was made.' },
            timezone: { type: 'string', example: 'UTC' },
            route: { type: 'string', maxLength: 500, description: 'Optional app route (helps the diagnosis find the screen).' },
            nearestTestid: { type: 'string', maxLength: 120 },
          },
        },
        ReportSubmission: {
          type: 'object',
          description:
            'One bug report. The SDKs fill this in for you; send it yourself from a server, a script or a no-code tool. Unknown top-level keys are accepted but not stored (extra keys inside environment are kept).',
          required: ['projectId', 'category', 'description', 'reporterToken', 'createdAt', 'environment'],
          additionalProperties: true,
          properties: {
            id: {
              type: 'string',
              description: 'Optional client id for safe retries (a UUID, or any string, mapped to one). A repeat of a stored id returns that report.',
            },
            projectId: { type: 'string', description: 'Your project id. Must match the key’s project (else 400 PROJECT_MISMATCH).' },
            category: {
              type: 'string',
              enum: [...REPORT_CATEGORY_UNION],
              description: 'feedback / question / feature are kept as the reporter’s own word and mapped onto the triage categories.',
            },
            description: {
              type: 'string',
              minLength: 1,
              maxLength: 5000,
              description: 'What the user saw, in their words. Under 20 characters is accepted and padded.',
            },
            reporterToken: {
              type: 'string',
              description: 'A stable random id for the reporter (no name or email). Reports with the same token group together.',
            },
            createdAt: { type: 'string', format: 'date-time', description: 'ISO 8601 with a time zone offset, e.g. 2026-11-18T09:00:00Z.' },
            environment: { $ref: '#/components/schemas/ReportEnvironment' },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            userCategory: { type: 'string', maxLength: 128 },
            userIntent: { type: 'string', description: 'What the user was trying to do.' },
            sessionId: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true, description: 'Free-form host data. Reporter identity may ride under `user`.' },
            consoleLogs: {
              type: 'array',
              items: {
                type: 'object',
                required: ['level', 'message', 'timestamp'],
                properties: {
                  level: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'debug'] },
                  message: { type: 'string' },
                  timestamp: { type: 'number' },
                  stack: { type: 'string' },
                },
              },
            },
            networkLogs: {
              type: 'array',
              items: {
                type: 'object',
                required: ['method', 'url', 'status', 'duration', 'timestamp'],
                properties: {
                  method: { type: 'string' },
                  url: { type: 'string' },
                  status: { type: 'number' },
                  duration: { type: 'number' },
                  timestamp: { type: 'number' },
                  error: { type: 'string' },
                },
              },
            },
            screenshotDataUrl: { type: 'string', maxLength: 2_100_000, description: 'data: URL, about 1.5 MB decoded at most.' },
          },
          examples: [REPORT_REQUEST_EXAMPLE],
        },
        ReportAccepted: {
          type: 'object',
          required: ['ok', 'data'],
          properties: {
            ok: { type: 'boolean', const: true },
            data: {
              type: 'object',
              required: ['reportId', 'status'],
              properties: {
                reportId: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['submitted', 'deduplicated'] },
                deduplicated: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    security: [{ mushiApiKey: [] }, { bearerAuth: [] }],
    paths: {
      // ── SDK-less ingest (any active project key; the SDK key is report:write) ──
      '/v1/reports': {
        post: {
          summary: 'File one bug report',
          description:
            'The call every SDK makes. Send it yourself with one curl from a server, a script or a no-code tool. Returns 201 with the report id; the plain-English diagnosis follows in the console and over MCP within about a minute. Rate limit: 120 reports a minute per project by default (project_settings.report_ingest_max_per_minute). The same reporterToken, description and category again within 60 seconds returns 200 status=deduplicated with the first report id. Send a stable `id` to make retries safe: a repeat of an id already stored returns that report instead of filing a second one.',
          operationId: 'createReport',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ReportSubmission' },
                example: REPORT_REQUEST_EXAMPLE,
              },
            },
          },
          responses: {
            '201': { description: 'Filed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportAccepted' } } } },
            '200': { description: 'Deduplicated into an existing report', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportAccepted' } } } },
            '400': {
              description: 'VALIDATION_ERROR (first check) or INGEST_ERROR / PROJECT_MISMATCH (full report schema).',
              content: {
                'application/json': {
                  schema: { oneOf: [{ $ref: '#/components/schemas/ValidationError' }, { $ref: '#/components/schemas/IngestError' }] },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '402': { $ref: '#/components/responses/QuotaExceeded' },
            '403': { $ref: '#/components/responses/ForbiddenKey' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/v1/reports/batch': {
        post: {
          summary: 'File up to 10 reports in one call (offline queues)',
          description:
            'Only the first 10 entries are kept; the rest are dropped without an error. Each entry is a ReportSubmission and is checked on its own, so one bad entry does not fail the others. Each entry counts against the per-minute rate limit.',
          operationId: 'createReportBatch',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['reports'],
                  properties: { reports: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/ReportSubmission' } } },
                },
              },
            },
          },
          responses: {
            '201': {
              description: '{ ok, data: { sent, failed, results: [{ ok, reportId?, error? }] } }',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          sent: { type: 'integer' },
                          failed: { type: 'integer' },
                          results: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: { ok: { type: 'boolean' }, reportId: { type: 'string', format: 'uuid' }, error: { type: 'string' } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'VALIDATION_ERROR: reports array required', content: { 'application/json': { schema: { $ref: '#/components/schemas/IngestError' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '402': { $ref: '#/components/responses/QuotaExceeded' },
            '403': { $ref: '#/components/responses/ForbiddenKey' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/v1/reports/{id}/status': {
        get: {
          summary: 'Status of one report this project filed',
          operationId: 'getReportStatus',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              description: 'Status and, once triaged, the diagnosis summary',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          status: { type: 'string', example: 'classified' },
                          category: { type: 'string' },
                          severity: { type: ['string', 'null'] },
                          summary: { type: ['string', 'null'] },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { description: 'NOT_FOUND (not this project’s report)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/reports/by-trace': {
        get: {
          summary: 'Reports that share a W3C or Sentry trace id (Sentry → Mushi Mushi deep links)',
          operationId: 'getReportsByTrace',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          parameters: [
            { name: 'traceId', in: 'query', schema: { type: 'string', pattern: '^[0-9a-fA-F]{32}$' } },
            { name: 'sentryTraceId', in: 'query', schema: { type: 'string', pattern: '^[0-9a-fA-F]{32}$' } },
          ],
          responses: {
            '200': { description: '{ ok, data: { reports } } (at most 25)' },
            '400': { description: 'MISSING_TRACE (neither id given) | INVALID_TRACE (not 32 hex)' },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/v1/ingest/spans': {
        post: {
          summary: 'Backend OpenTelemetry-style spans, joined to reports by trace id',
          description:
            'Body { spans: [ { traceId (32 hex), sessionId?, name?, attributes?, … } ] } (1–100), or one span object. Spans without a valid traceId are skipped. Attribute keys that look like secrets or personal data (password, token, authorization, cookie, email, phone, ssn) are redacted. 500 a minute per project.',
          operationId: 'ingestSpans',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    spans: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 100,
                      items: {
                        type: 'object',
                        required: ['traceId'],
                        additionalProperties: true,
                        properties: {
                          traceId: { type: 'string', pattern: '^[0-9a-fA-F]{32}$' },
                          sessionId: { type: 'string' },
                          attributes: { type: 'object', additionalProperties: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: '{ ok, data: { inserted, total } }' },
            '400': { description: 'INVALID_JSON | INVALID_PAYLOAD', content: { 'application/json': { schema: { $ref: '#/components/schemas/IngestError' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '413': { description: 'SPAN_TOO_LARGE (each span ≤ 8 KB)', content: { 'application/json': { schema: { $ref: '#/components/schemas/IngestError' } } } },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/v1/ingest/metrics': {
        post: {
          summary: 'Code-health and bundle-size metrics from CI (feeds the code_health gate)',
          description: 'Strict body: unknown top-level keys are rejected. At least one metric or one finding. 60 a minute per project.',
          operationId: 'ingestMetrics',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    metrics: {
                      type: 'array',
                      maxItems: 50,
                      items: {
                        type: 'object',
                        required: ['metric_name', 'value'],
                        properties: {
                          metric_name: { type: 'string', maxLength: 120, pattern: '^(bundle|code_health)\\.', description: 'Starts with bundle. or code_health.' },
                          dimension: { type: 'string', maxLength: 60 },
                          value: { type: 'number' },
                          ts: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                    findings: {
                      type: 'array',
                      maxItems: 200,
                      items: {
                        type: 'object',
                        required: ['rule_id', 'severity', 'message'],
                        properties: {
                          rule_id: { type: 'string', maxLength: 80 },
                          severity: { type: 'string', enum: ['error', 'warn', 'info'] },
                          file_path: { type: 'string', maxLength: 500 },
                          line: { type: 'integer', minimum: 0 },
                          message: { type: 'string', maxLength: 500 },
                          suggested_fix: { type: 'object', additionalProperties: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: '{ ok, data: { metrics_inserted, findings_inserted, gate_run_id } }' },
            '400': { description: 'INVALID_JSON | INVALID_PAYLOAD', content: { 'application/json': { schema: { $ref: '#/components/schemas/IngestError' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/v1/sdk/config': {
        get: {
          summary: 'Runtime widget config the console set for this project (the SDK merges it over its own defaults)',
          operationId: 'getSdkConfig',
          tags: ['ingest'],
          security: [{ mushiApiKey: ['report:write'] }],
          responses: {
            '200': { description: '{ ok, data: { widget, capture, assistant, … } } — cached privately for 60 s' },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/v1/health': {
        get: {
          summary: 'Liveness: is the API up (no key needed)',
          operationId: 'health',
          tags: ['ingest'],
          security: [],
          responses: { '200': { description: '{ status: "ok", version, deployed_at, region, hosting_region }' } },
        },
      },
      // ── CLI / MCP read mirror (API key; mcp:read unless noted) ───────────────
      '/v1/sync/whoami': {
        get: {
          summary: 'Which project this key belongs to, with report counts and linked repos (any project key)',
          operationId: 'syncWhoami',
          tags: ['sync'],
          security: [{ mushiApiKey: [] }],
          responses: { '200': { description: '{ ok, data: { project_id, project_name, repos, … } }' }, '401': { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/v1/sync/ingest-setup': {
        get: {
          summary: 'Is ingest wired up: key, first report, SDK heartbeat (any project key; what `mushi doctor` and diagnose_setup read)',
          operationId: 'syncIngestSetup',
          tags: ['sync'],
          security: [{ mushiApiKey: [] }],
          responses: { '200': { description: '{ ok, data } setup checklist' }, '401': { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/v1/sync/stats': {
        get: {
          summary: 'Report counts by status and severity',
          operationId: 'syncStats',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          responses: { '200': { description: '{ ok, data }' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/ForbiddenKey' } },
        },
      },
      '/v1/sync/reports': {
        get: {
          summary: 'List this project’s reports, newest first',
          operationId: 'syncListReports',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Substring match on summary and description' },
          ],
          responses: { '200': { description: '{ ok, data: { reports, total } }' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/ForbiddenKey' } },
        },
      },
      '/v1/sync/reports/{id}': {
        get: {
          summary: 'One report with its diagnosis',
          operationId: 'syncGetReport',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: '{ ok, data: { report } }' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/ForbiddenKey' },
            '404': { description: 'NOT_FOUND' },
          },
        },
      },
      '/v1/sync/reports/{id}/timeline': {
        get: {
          summary: 'Everything that happened on one report, oldest first',
          operationId: 'syncReportTimeline',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: '{ ok, data: { events } }' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/ForbiddenKey' } },
        },
      },
      '/v1/sync/reports/{id}/reply': {
        post: {
          summary: 'Reply to the person who filed the report (mcp:write)',
          operationId: 'syncReplyToReporter',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:write'] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    message: { type: 'string', minLength: 1, maxLength: 10_000 },
                    author_name: { type: 'string', maxLength: 100 },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ ok, data }' },
            '400': { description: 'BAD_REQUEST | VALIDATION_ERROR' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/ForbiddenKey' },
          },
        },
      },
      '/v1/sync/lessons': {
        get: {
          summary: 'Lessons: rules learned from repeated bugs, for your editor to read before a fix',
          operationId: 'syncListLessons',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          responses: { '200': { description: '{ ok, data }' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/ForbiddenKey' } },
        },
      },
      '/v1/sync/lessons/{id}': {
        get: {
          summary: 'One lesson',
          operationId: 'syncGetLesson',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ ok, data }' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/ForbiddenKey' }, '404': { description: 'NOT_FOUND' } },
        },
      },
      '/v1/sync/two-way-health': {
        get: {
          summary: 'Reporter two-way health: latest SDK heartbeat, unread reporter notifications, admin replies in the last 7 days',
          operationId: 'syncTwoWayHealth',
          tags: ['sync'],
          security: [{ mushiApiKey: ['mcp:read'] }],
          responses: { '200': { description: '{ ok, data }' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/ForbiddenKey' } },
        },
      },
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
      // ── Voice intake (Plan 017, ADR 0010) ─────────────────────────────────
      '/v1/intake/voice': {
        post: {
          summary: 'Voice intake — transcript or audio → report (+ draft-PR confirmation gate)',
          description:
            'Accepts { transcript } | { audio_path } (object in the voice-intake bucket) | { audio_base64, mime } (≤ 8 MB). Requires project_settings.voice_intake_enabled. Transcribes with the project OpenAI key (gpt-transcribe, then gpt-4o-mini-transcribe), strips invisible Unicode, refuses privileged verbs (merge/deploy/delete/… in EN and JA), classifies intent, creates the report. For open_draft_pr the session parks in awaiting_confirm with a single-use 10-minute confirm token; nothing is dispatched until /confirm. Reporter tokens are rejected.',
          operationId: 'voiceIntake',
          tags: ['voice'],
          security: [{ mushiApiKey: ['voice:write'] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    source: { type: 'string', enum: ['ios_shortcut', 'slack', 'telegram', 'pwa', 'api'], default: 'api' },
                    external_id: { type: 'string', description: 'Idempotency key (defaults to the Idempotency-Key header or a uuid)' },
                    transcript: { type: 'string', maxLength: 4000 },
                    audio_path: { type: 'string', description: 'Object path returned by /upload-url' },
                    audio_base64: { type: 'string' },
                    mime: { type: 'string' },
                    languages: { type: 'array', items: { type: 'string' }, description: 'BCP-47 hints for speech-to-text' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ ok, session: { id, status, transcript, action, summary, confirm_token?, report_id?, message } }' },
            '400': { description: 'VALIDATION_ERROR | AUTOFIX_DISABLED | UNSUPPORTED_STORAGE_PROVIDER' },
            '403': { description: 'VOICE_INTAKE_DISABLED | INSUFFICIENT_SCOPE | reporter credentials' },
            '429': { description: 'RATE_LIMITED (per project: 60/min, 30 intakes/min, 120 audio minutes/day)' },
            '502': { description: 'UPSTREAM_ERROR (speech-to-text)' },
          },
        },
      },
      '/v1/intake/voice/upload-url': {
        post: {
          summary: 'Voice intake — mint a signed upload URL into the private voice-intake bucket',
          operationId: 'voiceIntakeUploadUrl',
          tags: ['voice'],
          security: [{ mushiApiKey: ['voice:write'] }, { bearerAuth: [] }],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { mime: { type: 'string' } } } } } },
          responses: { '200': { description: '{ ok, data: { bucket, path, signedUrl, token, mime, expires_in } }' }, '400': { description: 'UNSUPPORTED_STORAGE_PROVIDER' } },
        },
      },
      '/v1/intake/voice/sessions': {
        get: {
          summary: 'Voice intake — list recent sessions for the project',
          operationId: 'voiceIntakeSessions',
          tags: ['voice'],
          security: [{ mushiApiKey: ['mcp:read'] }, { mushiApiKey: ['voice:write'] }, { bearerAuth: [] }],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }],
          responses: { '200': { description: '{ ok, data: { sessions } }' } },
        },
      },
      '/v1/intake/voice/{id}': {
        get: {
          summary: 'Voice intake — one session',
          operationId: 'voiceIntakeSession',
          tags: ['voice'],
          security: [{ mushiApiKey: ['mcp:read'] }, { mushiApiKey: ['voice:write'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: '{ ok, session }' }, '404': { description: 'NOT_FOUND' } },
        },
      },
      '/v1/intake/voice/{id}/confirm': {
        post: {
          summary: 'Voice intake — confirm the verbatim transcript and dispatch the draft-PR fix',
          operationId: 'voiceIntakeConfirm',
          tags: ['voice'],
          security: [{ mushiApiKey: ['voice:write'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } } },
          responses: {
            '200': { description: '{ ok, session: { id, status: dispatched, dispatch_id, report_id } }' },
            '403': { description: 'INVALID_CONFIRM_TOKEN' },
            '409': { description: 'CONFLICT (already confirmed / cancelled / ALREADY_DISPATCHED)' },
            '410': { description: 'EXPIRED (10-minute window passed)' },
          },
        },
      },
      '/v1/intake/voice/{id}/cancel': {
        post: {
          summary: 'Voice intake — cancel an awaiting_confirm session (nothing is dispatched)',
          operationId: 'voiceIntakeCancel',
          tags: ['voice'],
          security: [{ mushiApiKey: ['voice:write'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } } },
          responses: { '200': { description: '{ ok, session: { id, status: cancelled } }' }, '403': { description: 'INVALID_CONFIRM_TOKEN' }, '409': { description: 'CONFLICT' }, '410': { description: 'EXPIRED' } },
        },
      },
      // ── CI runners (Plan 022): host telemetry on a narrow key ──────────────
      '/v1/ingest/runner': {
        post: {
          summary: 'Runner host heartbeat or job memory sample (`mushi runner heartbeat`, runner job hooks)',
          description:
            'Body { kind: "heartbeat", host, runners[≤40] } or { kind: "job", host_id, runner_name, repo, run_id, run_attempt, job_key, phase, at, mem_peak_mb?, … }. Strict schema; host_id is the sha256 of the machine id (64 hex), never the raw id. Requires a project key carrying runner:write (mint one with POST /v1/admin/projects/{id}/runner-key); the SDK key and mcp:* keys are refused with 403 INSUFFICIENT_SCOPE. 60 a minute per project.',
          operationId: 'ingestRunner',
          tags: ['ci'],
          security: [{ mushiApiKey: ['runner:write'] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['heartbeat', 'job'] } } } } } },
          responses: { '200': { description: '{ ok, data }' }, '400': { description: 'VALIDATION_ERROR' }, '403': { description: 'INSUFFICIENT_SCOPE' }, '429': { description: 'RATE_LIMITED' } },
        },
      },
      '/v1/admin/projects/{id}/runner-key': {
        post: {
          summary: 'Mint a runner:write-only key for a CI runner host (plaintext returned once)',
          operationId: 'mintRunnerKey',
          tags: ['ci'],
          security: [{ mushiApiKey: ['mcp:write'] }, { bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string', maxLength: 56 } } } } } },
          responses: { '201': { description: '{ ok, data: { id, key, prefix, scopes: ["runner:write"], label } }' }, '403': { description: 'FORBIDDEN (viewer)' }, '404': { description: 'NOT_FOUND' }, '429': { description: 'RATE_LIMITED' } },
        },
      },
      // ── Ops hub: an app's payments, releases and alerts ───────────────────
      '/v1/ops/events': {
        post: {
          summary: 'Record one operational event from an app server (payment, release, alert) and post it to the team Slack',
          description:
            'Body { category: payments|releases|alerts, severity?: info|warn|urgent|resolved, kind, title (≤150), body? (≤600), facts?[≤8 {label,value}], url? (https), amount_minor?, currency?, thread_key?, dedupe_key?, occurred_at? }. Requires a project key carrying ops:write (mint one with POST /v1/admin/projects/{id}/ops-key); refused from a browser. 422 PII_REJECTED when a field carries an email or phone number. 202 once stored; Slack delivery runs after the answer. A repeated dedupe_key answers 200 with the stored id. 120 a minute per app (503 if the limit cannot be checked).',
          operationId: 'ingestOpsEvent',
          tags: ['ops'],
          security: [{ mushiApiKey: ['ops:write'] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['category', 'kind', 'title'], properties: { category: { type: 'string', enum: ['payments', 'releases', 'alerts'] }, kind: { type: 'string' }, title: { type: 'string', maxLength: 150 } } } } } },
          responses: { '202': { description: '{ ok, data: { id, status: created } }' }, '200': { description: '{ ok, data: { id, status: duplicate } }' }, '400': { description: 'VALIDATION_ERROR' }, '403': { description: 'INSUFFICIENT_SCOPE | KEY_EXPOSED_IN_BROWSER' }, '422': { description: 'PII_REJECTED' }, '429': { description: 'RATE_LIMITED' }, '503': { description: 'RATE_LIMIT_UNAVAILABLE' } },
        },
      },
      '/v1/admin/projects/{id}/ops-key': {
        post: {
          summary: 'Mint an ops:write-only key for an app server (plaintext returned once)',
          operationId: 'mintOpsKey',
          tags: ['ops'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '201': { description: '{ ok, data: { id, key, prefix, scopes: ["ops:write"], label } }' }, '403': { description: 'FORBIDDEN (viewer)' }, '404': { description: 'NOT_FOUND' }, '429': { description: 'RATE_LIMITED' } },
        },
      },
      '/v1/ops/slack/commands': {
        post: {
          summary: "The team's Slack slash command (status, sales, releases, alerts, bugs, ci, apps, mute, unmute, help)",
          description: "Signed with the organization's own Slack signing secret, found by team_id (v0 HMAC, 5-minute window). help answers inline; every other command answers through response_url.",
          operationId: 'opsSlackCommand',
          tags: ['ops'],
          responses: { '200': { description: 'ephemeral Block Kit reply or ack' }, '401': { description: 'BAD_SIGNATURE' } },
        },
      },
      '/v1/ops/slack/interactions': {
        post: {
          summary: 'Ops message buttons: Acknowledge, Mute 24h',
          description: "Signed with the organization's own Slack signing secret. Acts only on an event of the organization whose secret verified the request.",
          operationId: 'opsSlackInteraction',
          tags: ['ops'],
          responses: { '200': { description: 'ack' }, '401': { description: 'BAD_SIGNATURE' } },
        },
      },
      // ── Slack Events API + slash commands (voice inbox) ───────────────────
      '/v1/webhooks/slack/events': {
        post: {
          summary: 'Slack Events API receiver (url_verification, message with audio files[], file_shared)',
          description: 'Verified with the v0 HMAC signature (X-Slack-Signature / X-Slack-Request-Timestamp, 5-minute window). Acknowledges within the handler and transcribes the clip asynchronously; posts the verbatim transcript and Confirm / Cancel buttons in-thread.',
          operationId: 'slackEvents',
          tags: ['webhooks'],
          responses: { '200': { description: 'ack (or { challenge } for url_verification)' }, '401': { description: 'BAD_SIGNATURE' } },
        },
      },
      '/v1/webhooks/slack/commands': {
        post: {
          summary: 'Slack slash command /mushi voice <text> | list | open <id> | resolve <id> | help',
          operationId: 'slackCommands',
          tags: ['webhooks'],
          responses: { '200': { description: 'ephemeral response (application/json)' }, '401': { description: 'BAD_SIGNATURE' } },
        },
      },
      // ── Telegram admin (voice inbox binding) ───────────────────────────────
      '/v1/push/vapid-public-key': {
        get: {
          summary: 'Web Push — the applicationServerKey the browser needs before it can subscribe',
          description:
            'Public: the key is embedded in every subscription anyway. Returns 503 SERVER_MISCONFIGURED with reason=push_not_configured when the VAPID secrets are unset.',
          operationId: 'pushVapidPublicKey',
          tags: ['push'],
          security: [],
          responses: {
            '200': { description: '{ ok, publicKey } — cacheable for one hour' },
            '503': { description: 'SERVER_MISCONFIGURED — push_not_configured' },
          },
        },
      },
      '/v1/push/subscriptions': {
        post: {
          summary: 'Web Push — register this device for the signed-in console user',
          description:
            "The endpoint host must be a known push service (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com); anything else is rejected so a stored row can never become an SSRF target. Upserts on (user_id, endpoint).",
          operationId: 'pushSubscribe',
          tags: ['push'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['endpoint', 'keys'],
                  properties: {
                    endpoint: { type: 'string', format: 'uri' },
                    keys: {
                      type: 'object',
                      required: ['p256dh', 'auth'],
                      properties: {
                        p256dh: { type: 'string', description: 'base64url 65-byte P-256 public point' },
                        auth: { type: 'string', description: 'base64url 16-byte auth secret' },
                      },
                    },
                    projectId: { type: 'string', format: 'uuid', description: 'Optional context only; the subscription belongs to the user.' },
                    userAgent: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '{ ok, subscription }' },
            '400': { description: 'VALIDATION_ERROR — bad key length or a non-allowlisted host' },
            '401': { description: 'Authentication required' },
          },
        },
        delete: {
          summary: 'Web Push — unregister one endpoint for the signed-in user',
          operationId: 'pushUnsubscribe',
          tags: ['push'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string', format: 'uri' } } },
              },
            },
          },
          responses: { '200': { description: '{ ok, removed }' }, '401': { description: 'Authentication required' } },
        },
      },
      '/v1/push/test': {
        post: {
          summary: 'Web Push — send a test notification to every device registered for the signed-in user',
          description:
            'Rate limited to 5 per minute per user; a 429 carries Retry-After. A subscription the push service reports as gone (404/410) is deleted rather than retried.',
          operationId: 'pushTest',
          tags: ['push'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: '{ ok, sent, failed }' },
            '404': { description: 'NOT_FOUND — no subscriptions registered for this user' },
            '429': { description: 'RATE_LIMITED — Retry-After in seconds' },
            '502': { description: 'UPSTREAM_ERROR — every push service refused the message' },
            '503': { description: 'SERVER_MISCONFIGURED — push_not_configured' },
          },
        },
      },
      '/v1/admin/telegram/bind-code': {
        post: {
          summary: 'Mint a one-time /start code that binds a Telegram chat to this project (10 min)',
          operationId: 'telegramBindCode',
          tags: ['telegram'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: '{ ok, data: { code, expires_at } }' } },
        },
      },
      '/v1/admin/telegram/setup': {
        post: {
          summary: 'Register the telegram-webhook function with the project bot (setWebhook + secret token)',
          operationId: 'telegramSetup',
          tags: ['telegram'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: '{ ok, data: { webhook_url } }' }, '400': { description: 'telegram_bot_token_ref not configured' } },
        },
      },
      '/v1/admin/telegram/status': {
        get: {
          summary: 'Telegram inbox status: token saved, webhook registered, bound chats',
          operationId: 'telegramStatus',
          tags: ['telegram'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: '{ ok, data: { configured, bot_token_saved, webhook_registered, webhook_url, bindings } }' } },
        },
      },
      '/v1/admin/telegram/bindings/{chatId}': {
        delete: {
          summary: 'Unbind a Telegram chat from this project',
          operationId: 'telegramUnbind',
          tags: ['telegram'],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ ok, data: { removed } }' } },
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
        protocolVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
        description:
          'JSON-RPC 2.0 over Streamable HTTP. Use this for tool-call-shaped agent flows; the REST surface above is for direct CRUD.',
      },
      a2a: {
        agentCard: '/.well-known/agent-card',
        protocolVersion: '1.0.0',
      },
      schemas: {
        inventory: 'https://kensaur.us/mushi-mushi/schemas/inventory-2.0.json',
        fixContext: `${apiBase}/v1/schemas/fix-context.json`,
        fixResult: `${apiBase}/v1/schemas/fix-result.json`,
        sandboxProvider: `${apiBase}/v1/schemas/sandbox-provider.json`,
        expectedOutcome: `${apiBase}/v1/schemas/expected-outcome.json`,
      },
    },
  }
}
