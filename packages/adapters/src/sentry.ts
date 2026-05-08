/**
 * Sentry Integration webhook → Mushi adapter.
 *
 * Auth method: shared secret. Sentry does not sign webhook bodies with HMAC.
 * The Sentry App integration sends the configured secret verbatim in the
 * `sentry-hook-secret` header for each request.
 *
 * Header: `sentry-hook-secret` (shared secret, compared with `timingSafeEqual`).
 *
 * Events handled:
 *   - `event.alert`        — error-rule alert fired
 *   - `issue.alert`        — issue-alert rule fired
 *   - `metric_alert.open`  — metric alert threshold crossed
 *   - `metric_alert.resolve` — metric alert resolved
 *
 * The resource type is conveyed in the `sentry-hook-resource` header.
 *
 * @see https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
 */
import { timingSafeEqual } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface SentryEventData {
  id?: string
  title?: string
  culprit?: string
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | string
  project?: string
  url?: string
}

export interface SentryIssueData {
  id?: string
  title?: string
  culprit?: string
  status?: string
  level?: string
  permalink?: string
  project?: { slug?: string; name?: string }
}

export interface SentryMetricAlertData {
  id?: string | number
  title?: string
  description?: string
  alert_rule?: {
    id?: string | number
    name?: string
    status?: string
    threshold_type?: string
  }
}

export interface SentryPayload {
  action?: string
  actor?: { type?: string; id?: string | number; name?: string }
  data?: {
    event?: SentryEventData
    issue?: SentryIssueData
    metric_alert?: SentryMetricAlertData
  }
  installation?: { uuid?: string }
}

/**
 * Maps a raw Sentry webhook payload to a `MushiCaptureEventInput`.
 *
 * @param raw     - Parsed JSON body from Sentry.
 * @param resource - Value of the `sentry-hook-resource` header.
 * @param projectName - Optional project name override from adapter options.
 */
export function translateSentry(
  raw: SentryPayload,
  resource: string,
  projectName?: string,
): MushiCaptureEventInput {
  let description = 'Sentry alert'
  let severity: MushiCaptureEventInput['severity']
  let component: string | undefined = projectName

  if (resource === 'event.alert' && raw.data?.event) {
    const ev = raw.data.event
    description = ev.title ?? ev.culprit ?? `Sentry event ${ev.id ?? ''}`.trim()
    severity = mapLevel(ev.level)
    component = component ?? ev.project
  } else if (resource === 'issue.alert' && raw.data?.issue) {
    const issue = raw.data.issue
    description = issue.title ?? issue.culprit ?? `Sentry issue ${issue.id ?? ''}`.trim()
    severity = mapLevel(issue.level)
    component = component ?? issue.project?.name ?? issue.project?.slug
  } else if ((resource === 'metric_alert.open' || resource === 'metric_alert.resolve') && raw.data?.metric_alert) {
    const ma = raw.data.metric_alert
    description = ma.description ?? ma.title ?? ma.alert_rule?.name ?? `Sentry metric alert ${ma.id ?? ''}`.trim()
    severity = resource === 'metric_alert.resolve' ? undefined : 'high'
  }

  return {
    description,
    category: 'bug',
    severity,
    source: 'sentry',
    component,
    metadata: {
      resource,
      action: raw.action,
      installationUuid: raw.installation?.uuid,
      raw: raw.data,
    },
  }
}

export interface SentryAdapterOptions {
  sink: MushiCaptureSink
  /**
   * Shared secret configured in the Sentry webhook integration settings.
   * Compared against the `sentry-hook-secret` header value.
   */
  secret: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
}

/**
 * Creates a Sentry Integration webhook ingress handler.
 *
 * Verifies the `sentry-hook-secret` shared-secret header with `timingSafeEqual`,
 * then maps the Sentry payload to a `MushiCaptureEventInput` and forwards it
 * via the injected `sink`.
 *
 * Handles resource types: `event.alert`, `issue.alert`, `metric_alert.open`,
 * `metric_alert.resolve` (from the `sentry-hook-resource` header).
 */
export function createSentryAdapter(opts: SentryAdapterOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const supplied = extractHeader(req.headers, 'sentry-hook-secret')
    if (!supplied || !safeEqual(supplied, opts.secret)) {
      return { status: 401, body: { ok: false, error: 'BAD_SECRET' } }
    }
    const resource = extractHeader(req.headers, 'sentry-hook-resource') ?? ''
    let payload: SentryPayload
    try { payload = JSON.parse(req.rawBody) as SentryPayload } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }
    const id = await opts.sink(translateSentry(payload, resource, opts.projectName))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

function mapLevel(level: string | undefined): MushiCaptureEventInput['severity'] {
  switch ((level ?? '').toLowerCase()) {
    case 'fatal': return 'critical'
    case 'error': return 'high'
    case 'warning': return 'medium'
    case 'info':
    case 'debug': return 'low'
    default: return undefined
  }
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
