import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

/**
 * Grafana alert webhook (Loki + other datasources) → Mushi adapter.
 *
 * Grafana v11 posts a `GrafanaAlertManagerEvent` shape with `alerts[]`
 * each having `status`, `labels`, `annotations`, `startsAt`, `endsAt`.
 * We translate the FIRST firing alert and stash the rest under metadata
 * so a single report doesn't get flooded with every line of a noisy
 * alert group.
 */
export interface GrafanaAlertManagerEvent {
  receiver?: string
  status?: 'firing' | 'resolved' | string
  alerts?: Array<{
    status?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    startsAt?: string
    endsAt?: string
    generatorURL?: string
    fingerprint?: string
  }>
  commonLabels?: Record<string, string>
  commonAnnotations?: Record<string, string>
  externalURL?: string
}

export function translateGrafanaLoki(raw: GrafanaAlertManagerEvent): MushiCaptureEventInput {
  const firing = raw.alerts?.find(a => a.status === 'firing') ?? raw.alerts?.[0]
  const summary = firing?.annotations?.summary ?? firing?.annotations?.description ?? raw.receiver ?? 'Grafana alert'
  const severity = mapSeverity(firing?.labels?.severity ?? raw.commonLabels?.severity)
  return {
    description: summary,
    category: 'bug',
    severity,
    component: firing?.labels?.service ?? firing?.labels?.app,
    source: 'grafana-loki',
    tags: firing?.labels as Record<string, string> | undefined,
    metadata: {
      externalURL: raw.externalURL,
      generatorURL: firing?.generatorURL,
      commonLabels: raw.commonLabels,
      annotations: firing?.annotations,
      firingCount: raw.alerts?.filter(a => a.status === 'firing').length ?? 0,
    },
  }
}

export interface GrafanaHandlerOptions {
  sink: MushiCaptureSink
  /** Use Grafana's bearer token header to authenticate. */
  bearerToken: string
}

export function createGrafanaLokiWebhookHandler(opts: GrafanaHandlerOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const authz = extractHeader(req.headers, 'authorization')
    if (!authz || authz !== `Bearer ${opts.bearerToken}`) {
      return { status: 401, body: { ok: false, error: 'BAD_BEARER' } }
    }
    let payload: GrafanaAlertManagerEvent
    try { payload = JSON.parse(req.rawBody) as GrafanaAlertManagerEvent } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateGrafanaLoki(payload))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function mapSeverity(s: string | undefined): MushiCaptureEventInput['severity'] {
  const lc = (s ?? '').toLowerCase()
  if (lc === 'critical' || lc === 'page') return 'critical'
  if (lc === 'high' || lc === 'error') return 'high'
  if (lc === 'warning' || lc === 'warn') return 'medium'
  if (lc === 'info' || lc === 'low') return 'low'
  return undefined
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
