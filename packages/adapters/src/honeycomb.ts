import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

/**
 * Honeycomb Triggers webhook → Mushi adapter.
 * Honeycomb posts JSON with `name`, `summary`, `status`, `result_url`, and
 * a `result_groups_triggered` array. We use the trigger's `result_url` as
 * the metadata link so engineers can pivot back to raw telemetry.
 */
export interface HoneycombPayload {
  name?: string
  trigger_id?: string
  status?: string
  summary?: string
  result_url?: string
  result_groups_triggered?: Array<{ Group?: Record<string, unknown>; Result?: number }>
  severity?: string
}

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
  secret: string
  secretHeader?: string
}

export function createHoneycombWebhookHandler(opts: HoneycombHandlerOptions) {
  const headerName = (opts.secretHeader ?? 'x-mushi-honeycomb-secret').toLowerCase()
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, headerName)
    if (!supplied || supplied !== opts.secret) {
      return { status: 401, body: { ok: false, error: 'BAD_SECRET' } }
    }
    let payload: HoneycombPayload
    try { payload = JSON.parse(req.rawBody) as HoneycombPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateHoneycomb(payload))
    return { status: 200, body: { ok: true, reportId: id } }
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
