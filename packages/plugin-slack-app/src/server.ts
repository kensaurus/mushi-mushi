/**
 * packages/plugin-slack-app/src/server.ts
 *
 * Mushi → Slack event bridge.
 *
 * `createSlackPlugin` is a factory that returns a Mushi plugin handler (the
 * same callable signature as the pagerduty / sentry plugins). It subscribes to
 * key Mushi platform events and posts Block-Kit formatted messages to a Slack
 * Incoming Webhook URL.
 *
 * Block-Kit structure mirrors `packages/server/supabase/functions/_shared/slack.ts`
 * but adapted for the Node.js plugin runtime (no Deno APIs, config passed via
 * factory options instead of env vars).
 *
 * The factory also exposes a `handleSlackInteraction` method for mounting an
 * HTTP endpoint that receives Slack interactive component payloads (button
 * clicks). That endpoint verifies the Slack signing secret with `verifySlackRequest`
 * and is separate from the Mushi webhook path.
 *
 * Usage:
 *   const plugin = createSlackPlugin({ ... })
 *   app.post('/mushi/webhook', adaptToExpress(plugin))
 *   app.post('/slack/interactions', adaptInteractionsToExpress(plugin.handleSlackInteraction))
 */

import {
  createPluginHandler,
  withRetry,
  type MushiEventEnvelope,
  type MushiReportClassifiedEvent,
  type MushiReportStatusChangedEvent,
  type MushiFixEvent,
  type HandlePluginRequestInput,
  type HandlePluginResult,
} from '@mushi-mushi/plugin-sdk'
import { verifySlackRequest, type SlackVerifyInput } from './verify.js'

// ─── Block-Kit constants ─────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\u{1F6A8}', // 🚨
  high: '\u{1F534}',     // 🔴
  medium: '\u{1F7E1}',   // 🟡
  low: '\u{1F535}',      // 🔵
}

const CATEGORY_EMOJI: Record<string, string> = {
  bug: '\u{26A0}\u{FE0F}',       // ⚠️
  slow: '\u{1F40C}',             // 🐌
  visual: '\u{1F3A8}',           // 🎨
  confusing: '\u{1F615}',        // 😕
  other: '\u{1F4DD}',            // 📝
}

// ─── Public interface ────────────────────────────────────────────────────────

export interface SlackPluginConfig {
  /** Slack signing secret — used to verify inbound interaction payloads. */
  signingSecret: string
  /** Slack Incoming Webhook URL for posting event notifications. */
  webhookUrl: string
  /**
   * Admin panel base URL, e.g. `https://admin.mushimushi.dev`.
   * When provided, "Triage →" and "Dispatch fix" buttons are added to report
   * blocks. Omit or leave empty to degrade to plain link sections.
   */
  adminBaseUrl: string
  /** Mushi plugin signing secret (from the marketplace listing). */
  mushiSecret: string
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch
}

/** The Slack interaction handler signature for mounting as an HTTP endpoint. */
export interface SlackInteractionContext {
  rawBody: string
  headers: Record<string, string | undefined>
}

export type SlackInteractionResult = { status: number; body: object }

/** Return type of createSlackPlugin — callable as a Mushi handler, plus extras. */
export type SlackPlugin = ((
  input: HandlePluginRequestInput,
) => Promise<HandlePluginResult>) & {
  /**
   * Handle an inbound Slack interactive component payload (e.g. button click).
   * Verifies the Slack signing secret, parses the `payload` field, and returns
   * an HTTP status + body for the host to send back to Slack.
   *
   * Mount this at POST /slack/interactions (or similar).
   */
  handleSlackInteraction(ctx: SlackInteractionContext): Promise<SlackInteractionResult>
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSlackPlugin(config: SlackPluginConfig): SlackPlugin {
  const f = config.fetchImpl ?? fetch
  const baseUrl = config.adminBaseUrl.replace(/\/$/, '') || null

  /** Post a Block-Kit body to the configured Slack webhook with retry. */
  async function post(body: object): Promise<void> {
    await withRetry(async () => {
      const res = await f(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw res
    })
  }

  // ── Block builders ─────────────────────────────────────────────────────────

  function reportUrl(reportId: string): string | null {
    return baseUrl ? `${baseUrl}/reports/${encodeURIComponent(reportId)}` : null
  }

  function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 1) + '\u2026'
  }

  function buildClassifiedBlocks(
    data: MushiReportClassifiedEvent,
    reportId: string,
  ): unknown[] {
    const sev = data.classification.severity
    const cat = data.classification.category
    const sevBadge = SEVERITY_EMOJI[sev] ?? '\u26AA'
    const catBadge = CATEGORY_EMOJI[cat] ?? '\u{1F41B}'
    const url = reportUrl(reportId)

    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${catBadge} New ${sev} ${cat} report`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${data.report.title ?? `Report ${reportId.slice(0, 8)}`}*`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `${sevBadge} *${sev}*` },
          { type: 'mrkdwn', text: `*Category:* ${cat}` },
          {
            type: 'mrkdwn',
            text: `*Confidence:* ${Math.round(data.classification.confidence * 100)}%`,
          },
          ...(data.classification.tags?.length
            ? [{ type: 'mrkdwn', text: `*Tags:* ${data.classification.tags.join(', ')}` }]
            : []),
        ],
      },
    ]

    if (url) {
      blocks.push({
        type: 'actions',
        block_id: `mushi_report_${reportId}`,
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: 'Triage \u2192' },
            url,
            action_id: `open_report:${reportId}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Dispatch fix' },
            action_id: `dispatch_fix:${reportId}`,
            value: reportId,
            confirm: {
              title: { type: 'plain_text', text: 'Dispatch fix?' },
              text: {
                type: 'mrkdwn',
                text: 'This starts the auto-fix agent and opens a draft PR.',
              },
              confirm: { type: 'plain_text', text: 'Dispatch' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
        ],
      })
    }

    return blocks
  }

  function buildFixBlocks(
    data: MushiFixEvent,
    applied: boolean,
  ): unknown[] {
    const icon = applied ? '\u2705' : '\u{1F527}' // ✅ or 🔧
    const label = applied ? 'Fix applied' : 'Fix proposed'
    const url = reportUrl(data.report.id)

    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} ${label}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${data.report.title ?? `Report ${data.report.id.slice(0, 8)}`}*`,
        },
      },
    ]

    const ctxElements: unknown[] = []
    if (data.fix.pullRequestUrl) {
      ctxElements.push({
        type: 'mrkdwn',
        text: `*PR:* <${data.fix.pullRequestUrl}|${truncate(data.fix.pullRequestUrl, 60)}>`,
      })
    }
    if (data.fix.summary) {
      ctxElements.push({
        type: 'mrkdwn',
        text: `*Summary:* ${truncate(data.fix.summary, 120)}`,
      })
    }
    if (ctxElements.length > 0) {
      blocks.push({ type: 'context', elements: ctxElements })
    }

    if (url) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `<${url}|View in Mushi \u2192>` },
      })
    }

    return blocks
  }

  function buildStatusChangedBlocks(data: MushiReportStatusChangedEvent): unknown[] {
    const url = reportUrl(data.report.id)
    const icon = data.newStatus === 'fixed' || data.newStatus === 'resolved'
      ? '\u2705'  // ✅
      : '\u{1F504}' // 🔄

    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${icon} Status changed: ${data.previousStatus} \u2192 ${data.newStatus}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${data.report.title ?? `Report ${data.report.id.slice(0, 8)}`}*`,
        },
      },
    ]

    if (url) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `<${url}|View in Mushi \u2192>` },
      })
    }

    return blocks
  }

  // ── Mushi event subscriber ─────────────────────────────────────────────────

  const mushiHandler = createPluginHandler({
    secret: config.mushiSecret,
    on: {
      'report.classified': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiReportClassifiedEvent
        const reportId = data.report.id
        const blocks = buildClassifiedBlocks(data, reportId)
        const fallback = `${data.classification.severity} ${data.classification.category} report: ${data.report.title ?? reportId}`
        await post({ text: fallback, blocks })
      },

      'fix.proposed': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent
        const blocks = buildFixBlocks(data, false)
        const fallback = `Fix proposed for report ${data.report.title ?? data.report.id}`
        await post({ text: fallback, blocks })
      },

      'fix.applied': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent
        const blocks = buildFixBlocks(data, true)
        const fallback = `Fix applied for report ${data.report.title ?? data.report.id}`
        await post({ text: fallback, blocks })
      },

      'report.status_changed': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiReportStatusChangedEvent
        const blocks = buildStatusChangedBlocks(data)
        const fallback = `Report ${data.report.title ?? data.report.id}: ${data.previousStatus} → ${data.newStatus}`
        await post({ text: fallback, blocks })
      },
    },
    logger: {
      info: (msg, meta) => console.info(`[mushi-plugin-slack] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-slack] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-slack] ${msg}`, meta ?? ''),
    },
  })

  // ── Slack interaction handler ──────────────────────────────────────────────

  async function handleSlackInteraction(
    ctx: SlackInteractionContext,
  ): Promise<SlackInteractionResult> {
    const verifyInput: SlackVerifyInput = {
      rawBody: ctx.rawBody,
      timestampHeader: ctx.headers['x-slack-request-timestamp'],
      signatureHeader: ctx.headers['x-slack-signature'],
      signingSecret: config.signingSecret,
    }

    const verification = verifySlackRequest(verifyInput)
    if (!verification.ok) {
      return { status: 401, body: { ok: false, error: verification.reason } }
    }

    // Parse the URL-encoded `payload` field Slack sends for interactive components
    let interactionPayload: Record<string, unknown>
    try {
      const params = new URLSearchParams(ctx.rawBody)
      const raw = params.get('payload')
      if (!raw) return { status: 400, body: { ok: false, error: 'missing_payload' } }
      interactionPayload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { status: 400, body: { ok: false, error: 'invalid_payload' } }
    }

    // Log the action for observability; actual dispatch (e.g. fix-worker calls)
    // is left to the host application which has the Mushi API client context.
    const actionId = (
      (interactionPayload['actions'] as Array<{ action_id?: string }> | undefined)?.[0]
        ?.action_id ?? ''
    )
    console.info(`[mushi-plugin-slack] interaction received`, { actionId })

    // Acknowledge Slack's 3-second deadline immediately
    return { status: 200, body: { ok: true } }
  }

  return Object.assign(mushiHandler, { handleSlackInteraction })
}
