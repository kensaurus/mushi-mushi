/**
 * Zapier plugin for Mushi Mushi.
 *
 * Subscribes to all events (`*`). For each, POSTs a flattened JSON payload
 * (Zapier dislikes deep nesting in trigger samples) to the configured Zapier
 * "Catch Hook" URL. Optional event allow/deny lists let users gate which
 * triggers fire which Zaps.
 */

import { createPluginHandler, type MushiEventEnvelope } from '@mushi-mushi/plugin-sdk'

export interface ZapierPluginConfig {
  zapierHookUrl: string
  mushiSecret: string
  /** Only forward these events (whitelist). If empty, forward everything. */
  allowEvents?: string[]
  /** Drop these events (blacklist). Applied after `allowEvents`. */
  denyEvents?: string[]
  fetchImpl?: typeof fetch
}

export function createZapierPlugin(cfg: ZapierPluginConfig) {
  const f = cfg.fetchImpl ?? fetch
  const allow = new Set(cfg.allowEvents ?? [])
  const deny = new Set(cfg.denyEvents ?? [])

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      '*': async (e: MushiEventEnvelope) => {
        if (allow.size > 0 && !allow.has(e.event)) return
        if (deny.has(e.event)) return

        const flat = flattenForZapier(e)
        const res = await f(cfg.zapierHookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(flat),
        })
        if (!res.ok) throw new Error(`Zapier hook ${res.status}: ${await res.text()}`)
      },
    },
  })
}

function flattenForZapier(e: MushiEventEnvelope): Record<string, unknown> {
  const data = (e.data ?? {}) as Record<string, unknown>
  const report = (data.report ?? {}) as Record<string, unknown>
  return {
    event: e.event,
    delivery_id: e.deliveryId,
    occurred_at: e.occurredAt,
    project_id: e.projectId,
    plugin_slug: e.pluginSlug,
    report_id: report.id,
    report_status: report.status,
    report_category: report.category,
    report_severity: report.severity,
    report_title: report.title,
    raw: e,
  }
}
