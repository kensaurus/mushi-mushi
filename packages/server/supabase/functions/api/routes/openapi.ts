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

import { PUBLIC_CORS_HEADERS } from '../../_shared/cors.ts'
import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { API_ERROR_CODES } from '../../_shared/error-codes.ts'

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
        'Documents the endpoints external orchestrators (LangGraph, OpenAI Agents SDK, CrewAI, A2A agents) ' +
        'are expected to call. Internal admin-UI-only endpoints (settings forms, billing) are intentionally ' +
        'omitted — see /.well-known/agent-card for the discovery doc that advertises this spec.',
      contact: { name: 'Mushi Mushi', url: 'https://kensaur.us/mushi-mushi' },
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
