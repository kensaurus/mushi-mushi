/**
 * Honeycomb Triggers webhook → Mushi adapter.
 *
 * Auth method: HMAC-SHA256. Honeycomb computes HMAC-SHA256 of the raw request
 * body using the trigger's signing secret, and sends the result in the
 * `X-Honeycomb-Signature` header as `sha256=<hex>`.
 *
 * Header: `X-Honeycomb-Signature` (format: `sha256=<hex digest>`).
 *
 * Events handled: all Honeycomb trigger notifications — fired, resolved —
 * keyed by the `status` field in the payload. The `result_url` is stashed in
 * metadata so engineers can pivot back to raw telemetry.
 *
 * @see https://docs.honeycomb.io/send-data/triggers/#webhooks
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface HoneycombPayload {
  name?: string
  trigger_id?: string
  status?: string
  summary?: string
  result_url?: string
  result_groups_triggered?: Array<{ Group?: Record<string, unknown>; Result?: number }>
  severity?: string
}

/**
 * Maps a raw Honeycomb trigger payload to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateHoneycomb(raw: HoneycombPayload): MushiCaptureEventInput {
  return {
    description: raw.summary ?? raw.name ?? `Honeycomb trigger ${raw.trigger_id ?? ''}`.trim(),
    category: 'slow',
    severity: mapSeverity(raw.severity),
    source: 'honeycomb',
    metadata: {
      triggerId: raw.trigger_id,
      status: raw.status,
      link: raw.result_url,
      groups: raw.result_groups_triggered,
    },
  }
}

export interface HoneycombHandlerOptions {
  sink: MushiCaptureSink
  /**
   * Trigger signing secret from the Honeycomb UI.
   * Used as the HMAC-SHA256 key to verify `X-Honeycomb-Signature`.
   */
  webhookSecret: string
  /** Override the signature header name (default: `x-honeycomb-signature`). */
  signatureHeader?: string
}

/**
 * Creates a Honeycomb trigger webhook ingress handler.
 *
 * Verifies `X-Honeycomb-Signature` (format `sha256=<hex>` of raw request
 * body), then maps the Honeycomb payload to a `MushiCaptureEventInput` and
 * forwards it via the injected `sink`.
 */
export function createHoneycombWebhookHandler(opts: HoneycombHandlerOptions) {
  const headerName = (opts.signatureHeader ?? 'x-honeycomb-signature').toLowerCase()
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, headerName)
    if (!supplied || !verifyHmacSha256Prefixed(opts.webhookSecret, req.rawBody, supplied)) {
      return { status: 401, body: { ok: false, error: 'BAD_SIGNATURE' } }
    }
    let payload: HoneycombPayload
    try { payload = JSON.parse(req.rawBody) as HoneycombPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateHoneycomb(payload))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

/** Verifies an `sha256=<hex>` prefixed HMAC signature. */
function verifyHmacSha256Prefixed(secret: string, body: string, supplied: string): boolean {
  const hex = supplied.replace(/^sha256=/, '')
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hex, 'hex'))
  } catch {
    return false
  }
}

function mapSeverity(s: string | undefined): MushiCaptureEventInput['severity'] {
  const lc = (s ?? '').toLowerCase()
  if (lc.includes('critical')) return 'critical'
  if (lc.includes('high') || lc.includes('error')) return 'high'
  if (lc.includes('warn')) return 'medium'
  if (lc.includes('info')) return 'low'
  return undefined
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
