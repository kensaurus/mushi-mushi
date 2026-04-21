import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

/**
 * New Relic Alerts webhook → Mushi adapter.
 *
 * New Relic posts the `nrIncidentPayload` shape for modern alerts. Fields
 * we care about: `conditionName`, `details`, `priority`, `state`, `link`.
 */
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
  secret: string
  secretHeader?: string
}

export function createNewRelicWebhookHandler(opts: NewRelicHandlerOptions) {
  const headerName = (opts.secretHeader ?? 'x-mushi-newrelic-secret').toLowerCase()
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, headerName)
    if (!supplied || supplied !== opts.secret) {
      return { status: 401, body: { ok: false, error: 'BAD_SECRET' } }
    }
    let payload: NewRelicPayload
    try { payload = JSON.parse(req.rawBody) as NewRelicPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateNewRelic(payload))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
