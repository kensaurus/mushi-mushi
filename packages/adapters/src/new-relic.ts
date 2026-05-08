/**
 * New Relic Alerts webhook → Mushi adapter.
 *
 * Auth method: HMAC-SHA256. New Relic computes HMAC-SHA256 of the raw request
 * body using the webhook channel secret, and sends the hex digest in the
 * `X-NewRelic-Signature` header.
 *
 * Header: `X-NewRelic-Signature` (HMAC-SHA256 hex, no prefix).
 *
 * Events handled: all New Relic alert notification types — incident open,
 * close, and acknowledge — keyed by the `state` field in the payload.
 *
 * @see https://docs.newrelic.com/docs/alerts/get-notified/notification-integrations/#webhook
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface NewRelicPayload {
  incidentId?: string | number
  conditionName?: string
  conditionType?: string
  priority?: 'critical' | 'warning' | string
  state?: 'open' | 'closed' | string
  details?: string
  link?: string
  accountName?: string
  targets?: Array<{ name?: string; type?: string; product?: string }>
}

/**
 * Maps a raw New Relic alert payload to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateNewRelic(raw: NewRelicPayload): MushiCaptureEventInput {
  return {
    description: raw.details ?? raw.conditionName ?? `New Relic incident ${raw.incidentId ?? ''}`.trim(),
    category: raw.conditionType?.toLowerCase().includes('apm') ? 'slow' : 'bug',
    severity: raw.priority === 'critical' ? 'critical' : raw.priority === 'warning' ? 'medium' : undefined,
    source: 'new-relic',
    component: raw.targets?.[0]?.name,
    metadata: {
      incidentId: raw.incidentId,
      condition: raw.conditionName,
      state: raw.state,
      link: raw.link,
      accountName: raw.accountName,
    },
  }
}

export interface NewRelicHandlerOptions {
  sink: MushiCaptureSink
  /**
   * Webhook channel secret configured in New Relic.
   * Used as the HMAC-SHA256 key to verify `X-NewRelic-Signature`.
   */
  webhookSecret: string
  /** Override the signature header name (default: `x-newrelic-signature`). */
  signatureHeader?: string
}

/**
 * Creates a New Relic webhook ingress handler.
 *
 * Verifies `X-NewRelic-Signature` (HMAC-SHA256 hex of raw request body), then
 * maps the New Relic alert payload to a `MushiCaptureEventInput` and forwards
 * it via the injected `sink`.
 */
export function createNewRelicWebhookHandler(opts: NewRelicHandlerOptions) {
  const headerName = (opts.signatureHeader ?? 'x-newrelic-signature').toLowerCase()
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, headerName)
    if (!supplied || !verifyHmacSha256Hex(opts.webhookSecret, req.rawBody, supplied)) {
      return { status: 401, body: { ok: false, error: 'BAD_SIGNATURE' } }
    }
    let payload: NewRelicPayload
    try { payload = JSON.parse(req.rawBody) as NewRelicPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateNewRelic(payload))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function verifyHmacSha256Hex(secret: string, body: string, supplied: string): boolean {
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))
  } catch {
    return false
  }
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
