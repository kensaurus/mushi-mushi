// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Discord plugin for Mushi Mushi.
 *
 * Posts Discord embeds to an Incoming Webhook for key lifecycle events.
 * The embed color map mirrors the shared `packages/server/supabase/functions/_shared/discord.ts`
 * severity palette so Mushi notifications look consistent regardless of
 * which code path fires them.
 *
 * Events handled:
 *   - `report.classified`   — new classified bug (color by severity)
 *   - `fix.proposed`        — Mushi has proposed a fix (blue)
 *   - `fix.applied`         — fix merged (green)
 *   - `report.status_changed` — report moved to a new status (grey)
 *
 * Auth: Discord Incoming Webhook URL (no token required beyond the URL itself).
 *
 * All webhook calls are wrapped in `withRetry` from `@mushi-mushi/plugin-sdk`
 * to survive transient Discord 5xx responses.
 */

import {
  createPluginHandler,
  withRetry,
  type MushiEventEnvelope,
  type MushiFixEvent,
  type MushiReportClassifiedEvent,
  type MushiReportStatusChangedEvent,
} from '@mushi-mushi/plugin-sdk'

const SEVERITY_COLORS: Record<string, number> = {
  critical: 0xff0000,
  high: 0xff6600,
  medium: 0xffcc00,
  low: 0x00cc66,
}

const FIX_PROPOSED_COLOR = 0x5865f2
const FIX_APPLIED_COLOR = 0x57f287
const STATUS_CHANGED_COLOR = 0x99aab5
const DEFAULT_COLOR = 0x7c3aed

interface DiscordEmbed {
  title: string
  description?: string
  color: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  url?: string
  timestamp?: string
}

export interface DiscordPluginConfig {
  /** Discord Incoming Webhook URL. */
  webhookUrl: string
  /** Mushi admin base URL used to build deep-link report URLs. */
  adminBaseUrl: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

export function createDiscordPlugin(cfg: DiscordPluginConfig) {
  const f = cfg.fetchImpl ?? fetch
  const adminBase = cfg.adminBaseUrl.replace(/\/$/, '')

  function reportUrl(reportId: string): string {
    return `${adminBase}/reports/${encodeURIComponent(reportId)}`
  }

  async function postEmbed(embed: DiscordEmbed): Promise<void> {
    await withRetry(async () => {
      const res = await f(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Discord webhook ${res.status}: ${text.slice(0, 300)}`)
      }
    })
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiReportClassifiedEvent
        const { report, classification } = data
        const color = SEVERITY_COLORS[classification.severity] ?? DEFAULT_COLOR
        await postEmbed({
          title: `New ${classification.category} report classified`,
          description: report.title ?? `Mushi report \`${report.id.slice(0, 8)}...\``,
          color,
          fields: [
            { name: 'Severity', value: classification.severity, inline: true },
            { name: 'Confidence', value: `${Math.round(classification.confidence * 100)}%`, inline: true },
            { name: 'Report ID', value: `\`${report.id.slice(0, 8)}...\``, inline: true },
          ],
          url: reportUrl(report.id),
          timestamp: e.occurredAt,
        })
      },

      'fix.proposed': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent
        const { report, fix } = data
        const fields: DiscordEmbed['fields'] = [
          { name: 'Report', value: `\`${report.id.slice(0, 8)}...\``, inline: true },
          { name: 'Fix status', value: fix.status, inline: true },
        ]
        if (fix.pullRequestUrl) {
          fields.push({ name: 'Pull Request', value: fix.pullRequestUrl, inline: false })
        }
        await postEmbed({
          title: 'Fix proposed by Mushi',
          description: fix.summary ?? `A fix has been proposed for report \`${report.id.slice(0, 8)}...\``,
          color: FIX_PROPOSED_COLOR,
          fields,
          url: reportUrl(report.id),
          timestamp: e.occurredAt,
        })
      },

      'fix.applied': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent
        const { report, fix } = data
        const fields: DiscordEmbed['fields'] = [
          { name: 'Report', value: `\`${report.id.slice(0, 8)}...\``, inline: true },
          { name: 'Fix status', value: fix.status, inline: true },
        ]
        if (fix.pullRequestUrl) {
          fields.push({ name: 'Pull Request', value: fix.pullRequestUrl, inline: false })
        }
        await postEmbed({
          title: 'Fix applied — issue resolved',
          description: fix.summary ?? `Fix merged for report \`${report.id.slice(0, 8)}...\``,
          color: FIX_APPLIED_COLOR,
          fields,
          url: reportUrl(report.id),
          timestamp: e.occurredAt,
        })
      },

      'report.status_changed': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiReportStatusChangedEvent
        const { report } = data
        await postEmbed({
          title: `Report status changed`,
          description: `Report \`${report.id.slice(0, 8)}...\` moved from **${data.previousStatus}** to **${data.newStatus}**`,
          color: STATUS_CHANGED_COLOR,
          fields: [{ name: 'Report ID', value: `\`${report.id.slice(0, 8)}...\``, inline: true }],
          url: reportUrl(report.id),
          timestamp: e.occurredAt,
        })
      },
    },
    logger: {
      info: (msg, meta) => console.warn(`[mushi-plugin-discord] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-discord] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-discord] ${msg}`, meta ?? ''),
    },
  })
}
