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
 * Authentication: Datadog doesn't sign webhooks; the recommended
 * pattern is a shared-secret header. We enforce it below.
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
  /** Shared secret expected in `X-Mushi-Datadog-Secret` header. */
  secret: string
  /** Override the header name if you want to match another proxy. */
  secretHeader?: string
}

export function createDatadogWebhookHandler(opts: DatadogHandlerOptions) {
  const headerName = (opts.secretHeader ?? 'x-mushi-datadog-secret').toLowerCase()
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, headerName)
    if (!supplied || supplied !== opts.secret) {
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
