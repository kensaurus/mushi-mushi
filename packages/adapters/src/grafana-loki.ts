/**
 * Grafana alert webhook (Loki + other datasources) → Mushi adapter.
 *
 * Auth method: shared token. Grafana's webhook contact point does not sign
 * payloads with HMAC. The recommended pattern is a static secret in the
 * `X-Grafana-Token` header. Configure the header value in the Grafana contact
 * point UI and supply the same value here.
 *
 * Header: `X-Grafana-Token` (shared secret, compared with `timingSafeEqual`).
 *
 * Events handled: Grafana v11 `GrafanaAlertManagerEvent` — `firing` and
 * `resolved` status groups. Translates the first firing alert; remaining
 * alerts are stashed in `metadata.firingCount` to avoid report flooding.
 *
 * @see https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/
 */
import { timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

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

/**
 * Maps a raw Grafana AlertManager event to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
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
  /**
   * Static token expected in the `X-Grafana-Token` header. Configure the
   * same value in the Grafana webhook contact point settings. Grafana does
   * not use HMAC — this is a shared-secret comparison.
   */
  token: string
}

/**
 * Creates a Grafana webhook ingress handler.
 *
 * Verifies the `X-Grafana-Token` shared-secret header with `timingSafeEqual`,
 * then maps the Grafana AlertManager event to a `MushiCaptureEventInput` and
 * forwards it via the injected `sink`.
 */
export function createGrafanaLokiWebhookHandler(opts: GrafanaHandlerOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, 'x-grafana-token')
    if (!supplied || !safeEqual(supplied, opts.token)) {
      return { status: 401, body: { ok: false, error: 'BAD_TOKEN' } }
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

function safeEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
