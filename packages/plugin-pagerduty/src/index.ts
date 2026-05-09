/**
 * PagerDuty plugin for Mushi Mushi.
 *
 * Subscribes to `report.classified` and `sla.breached`. When the severity
 * crosses the configured threshold (default `critical`), opens a PagerDuty
 * Events API v2 incident routed via the configured routing key.
 *
 * Resolution: subscribes to `fix.applied` and `report.status_changed`. When
 * either fires for a previously-triggered incident, sends `event_action:
 * 'resolve'` with the same `dedup_key` so PagerDuty auto-closes the incident.
 *
 * All PagerDuty Events API v2 calls are wrapped in `withRetry` from
 * plugin-sdk, honouring 429 Retry-After headers and retrying 5xx responses
 * with exponential back-off + jitter.
 */

import {
  createPluginHandler,
  withRetry,
  type MushiEventEnvelope,
  type MushiReportClassifiedEvent,
  type MushiSlaBreachedEvent,
  type MushiFixEvent,
  type MushiReportStatusChangedEvent,
} from '@mushi-mushi/plugin-sdk'

const PD_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue'

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export interface PagerDutyPluginConfig {
  /** PagerDuty Events API v2 routing key (NOT the API token). */
  routingKey: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Lowest severity that triggers a page. Defaults to `critical`. */
  severityThreshold?: 'low' | 'medium' | 'high' | 'critical'
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

export interface DispatchResolvePayload {
  /** Mushi report ID (used for logging / metadata). */
  reportId: string
  /** PagerDuty dedup key — must match the one used when triggering. */
  dedupKey: string
  /** Human-readable summary included in the resolve payload. */
  summary: string
}

export function createPagerDutyPlugin(cfg: PagerDutyPluginConfig) {
  const minRank = SEVERITY_RANK[cfg.severityThreshold ?? 'critical']!
  const f = cfg.fetchImpl ?? fetch

  /**
   * Post a single payload to the PagerDuty Events API v2, retrying on 429 /
   * 5xx. Throws the raw Response so `withRetry` can inspect status + headers.
   */
  async function pdPost(body: Record<string, unknown>): Promise<void> {
    await withRetry(async () => {
      const res = await f(PD_EVENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw res
    })
  }

  function dedupKeyFor(envelope: MushiEventEnvelope): string {
    const reportId =
      (envelope.data as { report?: { id?: string } })?.report?.id ??
      envelope.deliveryId
    return `mushi:${envelope.projectId}:${reportId}`
  }

  async function trigger(
    envelope: MushiEventEnvelope,
    summary: string,
    severity: string,
  ): Promise<void> {
    await pdPost({
      routing_key: cfg.routingKey,
      event_action: 'trigger',
      dedup_key: dedupKeyFor(envelope),
      payload: {
        summary,
        severity,
        source: 'mushi-mushi',
        custom_details: envelope,
      },
    })
  }

  /**
   * Resolve a PagerDuty incident that was previously opened by `trigger`.
   *
   * Exported on the returned handler object so external code (e.g. a cron
   * that polls Mushi for already-resolved reports) can call it directly.
   */
  async function dispatchResolve(payload: DispatchResolvePayload): Promise<void> {
    await pdPost({
      routing_key: cfg.routingKey,
      event_action: 'resolve',
      dedup_key: payload.dedupKey,
      payload: {
        summary: payload.summary,
        severity: 'info',
        source: 'mushi-mushi',
        custom_details: { reportId: payload.reportId },
      },
    })
  }

  const handler = createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e) => {
        const data = e.data as MushiReportClassifiedEvent
        const rank = SEVERITY_RANK[data.classification.severity ?? ''] ?? 0
        if (rank < minRank) return
        await trigger(
          e,
          data.report.title ?? `Mushi: ${data.report.id}`,
          mapSeverity(data.classification.severity),
        )
      },

      'sla.breached': async (e) => {
        const data = e.data as MushiSlaBreachedEvent
        await trigger(
          e,
          `Mushi SLA breach: ${data.report.title ?? data.report.id}`,
          mapSeverity(data.sla.severity),
        )
      },

      'fix.applied': async (e) => {
        const data = e.data as MushiFixEvent
        await dispatchResolve({
          reportId: data.report.id,
          dedupKey: `mushi:${e.projectId}:${data.report.id}`,
          summary: `Fix applied: ${data.fix.summary ?? data.report.title ?? data.report.id}`,
        })
      },

      'report.status_changed': async (e) => {
        const data = e.data as MushiReportStatusChangedEvent
        if (data.newStatus !== 'fixed' && data.newStatus !== 'resolved') return
        await dispatchResolve({
          reportId: data.report.id,
          dedupKey: `mushi:${e.projectId}:${data.report.id}`,
          summary: `Report ${data.report.title ?? data.report.id} marked ${data.newStatus}`,
        })
      },
    },
  })

  // Attach dispatchResolve to the callable handler so external code can call it
  // without needing to reconstruct the routing key / fetch configuration.
  return Object.assign(handler, { dispatchResolve })
}

function mapSeverity(severity: string): 'critical' | 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'critical': return 'critical'
    case 'high':     return 'error'
    case 'medium':   return 'warning'
    default:         return 'info'
  }
}
