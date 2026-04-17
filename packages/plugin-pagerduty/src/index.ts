/**
 * PagerDuty plugin for Mushi Mushi.
 *
 * Subscribes to `report.classified` and `sla.breached`. When the severity
 * crosses the configured threshold (default `critical`), opens a PagerDuty
 * Events API v2 incident routed via the configured routing key.
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiReportClassifiedEvent,
  type MushiSlaBreachedEvent,
} from '@mushi-mushi/plugin-sdk'

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

export function createPagerDutyPlugin(cfg: PagerDutyPluginConfig) {
  const minRank = SEVERITY_RANK[cfg.severityThreshold ?? 'critical']!
  const f = cfg.fetchImpl ?? fetch

  async function trigger(envelope: MushiEventEnvelope, summary: string, severity: string) {
    const res = await f('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: cfg.routingKey,
        event_action: 'trigger',
        dedup_key: `mushi:${envelope.projectId}:${(envelope.data as { report?: { id?: string } })?.report?.id ?? envelope.deliveryId}`,
        payload: {
          summary,
          severity,
          source: 'mushi-mushi',
          custom_details: envelope,
        },
      }),
    })
    if (!res.ok) throw new Error(`PagerDuty API ${res.status}: ${await res.text()}`)
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e) => {
        const data = e.data as MushiReportClassifiedEvent
        const rank = SEVERITY_RANK[data.classification.severity ?? ''] ?? 0
        if (rank < minRank) return
        await trigger(e, data.report.title ?? `Mushi: ${data.report.id}`, mapSeverity(data.classification.severity))
      },
      'sla.breached': async (e) => {
        const data = e.data as MushiSlaBreachedEvent
        await trigger(e, `Mushi SLA breach: ${data.report.title ?? data.report.id}`, mapSeverity(data.sla.severity))
      },
    },
  })
}

function mapSeverity(severity: string): 'critical' | 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'critical': return 'critical'
    case 'high':     return 'error'
    case 'medium':   return 'warning'
    default:         return 'info'
  }
}
