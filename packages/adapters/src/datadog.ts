import { timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

/**
 * Datadog → Mushi adapter.
 *
 * Datadog webhooks POST JSON matching the "Custom Webhook" template
 * variables. We accept the default body shape from Datadog and map
 * `priority` + `alert_status` onto Mushi severity so a Datadog P1 lines
 * up with Mushi `critical`.
 *
 * Auth method: Datadog does not sign webhook payloads with HMAC. The
 * recommended pattern is a shared-secret header (`X-Datadog-Secret-Token`).
 * This is Datadog's own design — configure the header value in the Datadog
 * webhook integration UI and supply the same value to this adapter.
 *
 * Header: `X-Datadog-Secret-Token` (shared secret, compared with
 * `timingSafeEqual` to avoid timing attacks).
 *
 * Events handled: all Datadog alert types (error, warning, info) keyed by
 * `alert_type` in the payload.
 *
 * @see https://docs.datadoghq.com/integrations/webhooks/
 */
export interface DatadogPayload {
  id?: string
  alert_id?: string
  title?: string
  body?: string
  link?: string
  priority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | string
  alert_status?: string
  alert_type?: 'error' | 'warning' | 'info' | string
  tags?: string | string[]
}

export function translateDatadog(raw: DatadogPayload): MushiCaptureEventInput {
  const severity = mapPriority(raw.priority)
  const tags = normalizeTags(raw.tags)
  return {
    description: raw.title ?? raw.body?.slice(0, 200) ?? `Datadog alert ${raw.alert_id ?? raw.id ?? ''}`.trim(),
    category: raw.alert_type === 'error' ? 'bug' : 'slow',
    severity,
    component: tags.service,
    source: 'datadog',
    tags,
    metadata: {
      alertId: raw.alert_id ?? raw.id,
      status: raw.alert_status,
      link: raw.link,
      body: raw.body,
    },
  }
}

export interface DatadogHandlerOptions {
  sink: MushiCaptureSink
  /**
   * Shared secret to compare against the `X-Datadog-Secret-Token` header.
   * Configure the same value in the Datadog webhook integration UI.
   * Datadog does not use HMAC — this is a direct constant-time comparison.
   */
  secret: string
  /** Override the header name (default: `x-datadog-secret-token`). */
  secretHeader?: string
}

/**
 * Creates a Datadog webhook ingress handler.
 *
 * Verifies the `X-Datadog-Secret-Token` shared-secret header, then maps the
 * Datadog alert payload to a `MushiCaptureEventInput` and forwards it via
 * the injected `sink`.
 *
 * Note: Datadog does not sign webhook bodies with HMAC. The `secret` field is
 * compared with `timingSafeEqual` to resist timing side-channels even though
 * it is a plain string comparison.
 */
export function createDatadogWebhookHandler(opts: DatadogHandlerOptions) {
  const headerName = (opts.secretHeader ?? 'x-datadog-secret-token').toLowerCase()
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, headerName)
    if (!supplied || !safeEqual(supplied, opts.secret)) {
      return { status: 401, body: { ok: false, error: 'BAD_SECRET' } }
    }
    let payload: DatadogPayload
    try { payload = JSON.parse(req.rawBody) as DatadogPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateDatadog(payload))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function mapPriority(p: string | undefined): MushiCaptureEventInput['severity'] {
  switch ((p ?? '').toUpperCase()) {
    case 'P1': return 'critical'
    case 'P2': return 'high'
    case 'P3': return 'medium'
    case 'P4':
    case 'P5': return 'low'
    default: return undefined
  }
}

function normalizeTags(tags: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!tags) return out
  const arr = Array.isArray(tags) ? tags : tags.split(',')
  for (const raw of arr) {
    const [k, v] = raw.split(':', 2)
    if (k && v) out[k.trim()] = v.trim()
  }
  return out
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}

function safeEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
