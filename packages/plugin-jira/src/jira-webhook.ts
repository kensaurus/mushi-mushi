/**
 * packages/plugin-jira/src/jira-webhook.ts
 *
 * Inbound Jira → Mushi webhook bridge.
 *
 * Jira POSTs signed webhook events here when an issue's status changes. We:
 *   1. Verify the HMAC-SHA256 signature in `X-Hub-Signature-256` (same format
 *      as GitHub webhooks: `sha256=<hex>`).
 *   2. Resolve the Mushi report ID from the issue's entity property
 *      `mushi.reportId` (stored by `packages/plugin-jira/src/client.ts` when
 *      the Jira issue was first created by the Mushi → Jira direction).
 *   3. If the issue transitioned to a "done" status category, call the Mushi
 *      REST API to mark the linked report `fixed`.
 *   4. If the webhook also carries a new comment, mirror it into Mushi as an
 *      internal (non-reporter-visible) comment so the activity log stays in
 *      sync.
 *
 * All outbound Mushi API calls are wrapped in `withRetry` from plugin-sdk.
 *
 * Setup in Jira (classic UI):
 *   Administration → System → WebHooks → Create
 *   URL:    https://your-plugin-host/jira/webhook
 *   Secret: the value you pass as `opts.secret`
 *   Events: Issue updated / Issue resolved
 *   ✓ Check "Include entity properties" so `mushi.reportId` is delivered
 *
 * Referenced by: packages/plugin-jira/src/handler.ts (see module-level JSDoc)
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { withRetry } from '@mushi-mushi/plugin-sdk'

// ─── Public interface ────────────────────────────────────────────────────────

export interface JiraWebhookReceiverOptions {
  /** Webhook secret configured in the Jira WebHook registration form. */
  secret: string
  /** Mushi REST API base URL, e.g. `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`. */
  apiEndpoint: string
  /** Mushi plugin API key (issued from the marketplace listing). */
  apiKey: string
  /** Mushi project ID this receiver is operating under. */
  projectId: string
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Creates a Node.js `(req, res)` handler that ingests Jira webhook events and
 * mirrors relevant state changes back to Mushi.
 *
 * Mount it at the path you register in your Jira webhook settings:
 *   `app.post('/jira/webhook', createJiraWebhookReceiver(opts))`
 *
 * The handler always responds 200 to Jira immediately (Jira stops retrying on
 * non-2xx after a few attempts, so we ack first and process asynchronously).
 */
export function createJiraWebhookReceiver(
  opts: JiraWebhookReceiverOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const f = opts.fetchImpl ?? fetch
  const baseUrl = opts.apiEndpoint.replace(/\/$/, '')

  return async function jiraWebhookHandler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Collect request body
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', resolve)
      req.on('error', reject)
    })
    const rawBody = Buffer.concat(chunks).toString('utf8')

    // Signature check — Jira sends X-Hub-Signature-256 or X-Hub-Signature
    const sigHeader =
      pickHeader(req.headers, 'x-hub-signature-256') ??
      pickHeader(req.headers, 'x-hub-signature') ??
      ''
    if (!verifyJiraSignature(rawBody, sigHeader, opts.secret)) {
      respond(res, 401, { ok: false, error: 'signature_mismatch' })
      return
    }

    let payload: JiraWebhookPayload
    try {
      payload = JSON.parse(rawBody) as JiraWebhookPayload
    } catch {
      respond(res, 400, { ok: false, error: 'invalid_json' })
      return
    }

    // Ack Jira immediately; Jira stops retrying on non-2xx after a short window
    respond(res, 200, { ok: true })

    // Process asynchronously after the response is flushed
    processJiraEvent(payload, { f, baseUrl, opts }).catch((err) => {
      console.error('[mushi-plugin-jira] webhook processing error', String(err))
    })
  }
}

// ─── Internal payload shapes ─────────────────────────────────────────────────

interface JiraIssueProperty {
  key: string
  value: unknown
}

interface JiraWebhookPayload {
  webhookEvent?: string
  issue?: {
    id?: string
    key?: string
    fields?: {
      status?: {
        name?: string
        statusCategory?: { key?: string; name?: string }
      }
      summary?: string
    }
    properties?: JiraIssueProperty[]
  }
  changelog?: {
    items?: Array<{ field?: string; toString?: string; fromString?: string }>
  }
  comment?: {
    id?: string
    author?: { displayName?: string; emailAddress?: string }
    body?: string
  }
}

// ─── Event processor ─────────────────────────────────────────────────────────

const DONE_CATEGORY_KEYS = new Set(['done'])
const DONE_STATUS_NAMES = new Set([
  'done',
  'resolved',
  'closed',
  "won't do",
  'complete',
  'completed',
])

interface ProcessCtx {
  f: typeof fetch
  baseUrl: string
  opts: JiraWebhookReceiverOptions
}

async function processJiraEvent(
  payload: JiraWebhookPayload,
  ctx: ProcessCtx,
): Promise<void> {
  const event = payload.webhookEvent ?? ''
  const issue = payload.issue
  if (!issue) return

  const mushiReportId = extractMushiReportId(issue)
  if (!mushiReportId) return // not a Mushi-tracked issue

  if (event === 'jira:issue_updated' || event === 'jira:issue_resolved') {
    const statusName = issue.fields?.status?.name ?? ''
    const statusCategory = issue.fields?.status?.statusCategory?.key ?? ''

    const isDone =
      DONE_CATEGORY_KEYS.has(statusCategory.toLowerCase()) ||
      DONE_STATUS_NAMES.has(statusName.toLowerCase())

    if (isDone) {
      await withRetry(async () => {
        const res = await ctx.f(
          `${ctx.baseUrl}/v1/reports/${encodeURIComponent(mushiReportId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-Mushi-Api-Key': ctx.opts.apiKey,
              'X-Mushi-Project': ctx.opts.projectId,
            },
            body: JSON.stringify({
              status: 'fixed',
              statusReason: `Jira issue ${issue.key ?? ''} transitioned to ${statusName}`,
            }),
          },
        )
        if (!res.ok) throw res
      })
    }
  }

  // Mirror Jira comments into Mushi as internal notes
  if (payload.comment?.body) {
    const author =
      payload.comment.author?.displayName ??
      payload.comment.author?.emailAddress ??
      'Jira user'
    const text = `[Jira comment from ${author} on ${issue.key ?? 'issue'}]\n\n${payload.comment.body}`
    await withRetry(async () => {
      const res = await ctx.f(
        `${ctx.baseUrl}/v1/reports/${encodeURIComponent(mushiReportId)}/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Mushi-Api-Key': ctx.opts.apiKey,
            'X-Mushi-Project': ctx.opts.projectId,
          },
          body: JSON.stringify({ body: text, visibleToReporter: false }),
        },
      )
      if (!res.ok) throw res
    })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the Mushi report ID from a Jira issue's entity properties.
 *
 * The property is written as `{ key: 'mushi.reportId', value: { reportId: '...' } }`
 * by `client.ts` when creating the issue. Jira includes entity properties in
 * webhook payloads only when the webhook is registered with
 * `includeEntityProperties: true` (via the REST API) or the checkbox in the
 * classic WebHooks UI.
 */
function extractMushiReportId(
  issue: NonNullable<JiraWebhookPayload['issue']>,
): string | null {
  const props = issue.properties
  if (!Array.isArray(props)) return null
  for (const prop of props) {
    if (prop.key !== 'mushi.reportId') continue
    const v = prop.value
    if (v !== null && typeof v === 'object' && 'reportId' in (v as object)) {
      return String((v as Record<string, unknown>)['reportId'])
    }
    if (typeof v === 'string') return v
  }
  return null
}

/**
 * Verify a Jira HMAC-SHA256 webhook signature.
 *
 * Jira sends `X-Hub-Signature-256: sha256=<hex>` (same format as GitHub).
 * We strip the `sha256=` prefix, recompute with the shared secret, and use
 * constant-time comparison to prevent timing attacks.
 */
function verifyJiraSignature(rawBody: string, header: string, secret: string): boolean {
  if (!header) return false
  const hexPart = header.startsWith('sha256=') ? header.slice(7) : header
  if (!hexPart) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  if (expected.length !== hexPart.length) return false
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(hexPart, 'hex'),
    )
  } catch {
    return false
  }
}

function pickHeader(
  headers: IncomingMessage['headers'],
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

function respond(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
