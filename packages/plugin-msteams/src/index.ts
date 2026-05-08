/**
 * Microsoft Teams plugin for Mushi Mushi.
 *
 * Posts Adaptive Cards to a Teams channel via an Incoming Webhook connector.
 * Uses the legacy Incoming Webhook format (still supported in 2026) which
 * wraps an Adaptive Card inside a `message` attachment envelope.
 *
 * Adaptive Card version: 1.4 — compatible with Teams desktop, web, and
 * mobile clients that shipped after 2021.
 *
 * Events handled:
 *   - `report.classified` — new classified bug with severity badge
 *   - `fix.proposed`      — Mushi has opened a fix PR
 *   - `fix.applied`       — fix has been merged
 *
 * Auth: Teams Incoming Webhook URL (no additional token required beyond
 * the URL itself, which embeds the connector auth).
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiFixEvent,
  type MushiReportClassifiedEvent,
} from '@mushi-mushi/plugin-sdk'

export interface MsteamsPluginConfig {
  /** Microsoft Teams Incoming Webhook URL. */
  webhookUrl: string
  /** Mushi admin base URL used to build deep-link report URLs. */
  adminBaseUrl: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

type AdaptiveCardBody = Array<Record<string, unknown>>
type AdaptiveCardAction = Record<string, unknown>

interface TeamsWebhookPayload {
  type: 'message'
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive'
    content: {
      $schema: string
      type: 'AdaptiveCard'
      version: '1.4'
      body: AdaptiveCardBody
      actions: AdaptiveCardAction[]
    }
  }>
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'attention',
  high: 'warning',
  medium: 'accent',
  low: 'good',
}

export function createMsteamsPlugin(cfg: MsteamsPluginConfig) {
  const f = cfg.fetchImpl ?? fetch
  const adminBase = cfg.adminBaseUrl.replace(/\/$/, '')

  function reportUrl(reportId: string): string {
    return `${adminBase}/reports/${encodeURIComponent(reportId)}`
  }

  function buildPayload(body: AdaptiveCardBody, actions: AdaptiveCardAction[] = []): TeamsWebhookPayload {
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body,
            actions,
          },
        },
      ],
    }
  }

  async function post(payload: TeamsWebhookPayload): Promise<void> {
    const res = await f(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Teams webhook ${res.status}: ${text.slice(0, 300)}`)
    }
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiReportClassifiedEvent
        const { report, classification } = data
        const color = SEVERITY_COLORS[classification.severity] ?? 'accent'

        const body: AdaptiveCardBody = [
          {
            type: 'TextBlock',
            size: 'Large',
            weight: 'Bolder',
            text: `New ${classification.category} report classified`,
            wrap: true,
          },
          {
            type: 'TextBlock',
            text: report.title ?? `Mushi report \`${report.id.slice(0, 8)}...\``,
            wrap: true,
            spacing: 'None',
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Severity', value: classification.severity },
              { title: 'Category', value: classification.category },
              { title: 'Confidence', value: `${Math.round(classification.confidence * 100)}%` },
              { title: 'Report ID', value: `\`${report.id.slice(0, 8)}...\`` },
            ],
          },
          {
            type: 'TextBlock',
            text: e.occurredAt,
            size: 'Small',
            color: 'default',
            isSubtle: true,
            spacing: 'Medium',
          },
        ]

        await post(
          buildPayload(
            [
              {
                type: 'Container',
                style: color,
                items: body,
              },
            ],
            [
              {
                type: 'Action.OpenUrl',
                title: 'View in Mushi',
                url: reportUrl(report.id),
              },
            ],
          ),
        )
      },

      'fix.proposed': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent
        const { report, fix } = data

        const facts: Array<{ title: string; value: string }> = [
          { title: 'Report ID', value: `\`${report.id.slice(0, 8)}...\`` },
          { title: 'Fix status', value: fix.status },
        ]
        if (fix.branch) facts.push({ title: 'Branch', value: fix.branch })

        const actions: AdaptiveCardAction[] = [
          { type: 'Action.OpenUrl', title: 'View report', url: reportUrl(report.id) },
        ]
        if (fix.pullRequestUrl) {
          actions.push({ type: 'Action.OpenUrl', title: 'View Pull Request', url: fix.pullRequestUrl })
        }

        await post(
          buildPayload([
            {
              type: 'Container',
              style: 'accent',
              items: [
                { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: 'Fix proposed by Mushi', wrap: true },
                {
                  type: 'TextBlock',
                  text: fix.summary ?? `A fix has been proposed for report \`${report.id.slice(0, 8)}...\``,
                  wrap: true,
                  spacing: 'None',
                },
                { type: 'FactSet', facts },
              ],
            },
          ], actions),
        )
      },

      'fix.applied': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent
        const { report, fix } = data

        const actions: AdaptiveCardAction[] = [
          { type: 'Action.OpenUrl', title: 'View report', url: reportUrl(report.id) },
        ]
        if (fix.pullRequestUrl) {
          actions.push({ type: 'Action.OpenUrl', title: 'View merged PR', url: fix.pullRequestUrl })
        }

        await post(
          buildPayload([
            {
              type: 'Container',
              style: 'good',
              items: [
                { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: 'Fix applied — issue resolved', wrap: true },
                {
                  type: 'TextBlock',
                  text: fix.summary ?? `Fix merged for report \`${report.id.slice(0, 8)}...\``,
                  wrap: true,
                  spacing: 'None',
                },
                {
                  type: 'FactSet',
                  facts: [
                    { title: 'Report ID', value: `\`${report.id.slice(0, 8)}...\`` },
                    { title: 'Fix status', value: fix.status },
                  ],
                },
              ],
            },
          ], actions),
        )
      },
    },
    logger: {
      info: (msg, meta) => console.log(`[mushi-plugin-msteams] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-msteams] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-msteams] ${msg}`, meta ?? ''),
    },
  })
}
