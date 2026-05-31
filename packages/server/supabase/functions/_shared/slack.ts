/**
 * FILE: packages/server/supabase/functions/_shared/slack.ts
 * PURPOSE: Slack delivery helper. Two delivery paths:
 *
 *   1. WEBHOOK PATH (legacy, still supported for backwards-compat):
 *      `sendSlackNotification(webhookUrl, payload)` / `sendSlackText(webhookUrl, text)`
 *      Uses incoming webhook URLs stored per project in `slack_webhook_url`.
 *      Pros: simple, no auth. Cons: no thread replies, no `ts` tracking.
 *
 *   2. BOT PATH (recommended, new default):
 *      `sendBotMessage({ channel, blocks, text, threadTs? })`
 *      Uses `chat.postMessage` with SLACK_BOT_TOKEN (xoxb-).
 *      Returns `{ ok, ts }` — the `ts` can be stored on the report row
 *      and used to post threaded follow-up messages (fix dispatched, PR link).
 *
 * Threading flow
 * --------------
 *   classify-report/fast-filter
 *     → sendBotMessage → stores ts → reports.slack_message_ts
 *   slack-interactions (Dispatch fix button)
 *     → sendBotMessage({ threadTs: report.slack_message_ts })  ← threaded reply
 *   fix-worker / copilot
 *     → sendBotMessage({ threadTs }) once PR is opened
 *
 * Security note:
 *   SLACK_BOT_TOKEN must be the Bot User OAuth Token (xoxb-*) for `chat.postMessage`.
 *   Do NOT put it in the repo or in project_settings — keep it as a Supabase secret.
 */

import { log } from './logger.ts'

const slackLog = log.child('slack')

interface SlackReportPayload {
  projectName: string
  category: string
  severity: string
  summary: string
  reporterToken: string
  pageUrl: string
  reportId: string
}

interface SlackTextPayload {
  text: string
}

type SlackPayload = SlackReportPayload | SlackTextPayload

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\u{1F6A8}',
  high: '\u{1F534}',
  medium: '\u{1F7E1}',
  low: '\u{1F535}',
}

const CATEGORY_EMOJI: Record<string, string> = {
  bug: '\u{26A0}\u{FE0F}',
  slow: '\u{1F40C}',
  visual: '\u{1F3A8}',
  confusing: '\u{1F615}',
  other: '\u{1F4DD}',
}

function isReportPayload(p: SlackPayload): p is SlackReportPayload {
  return typeof (p as SlackReportPayload).reportId === 'string'
}

function adminBaseUrl(): string | null {
  const raw = Deno.env.get('ADMIN_BASE_URL')
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

function buildReportBlocks(payload: SlackReportPayload): unknown[] {
  const base = adminBaseUrl()
  const reportUrl = base ? `${base}/reports/${encodeURIComponent(payload.reportId)}` : null
  const severityBadge = SEVERITY_EMOJI[payload.severity] ?? '\u{26AA}'
  const categoryBadge = CATEGORY_EMOJI[payload.category] ?? '\u{1F41B}'

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${categoryBadge} New ${payload.severity} ${payload.category} — ${payload.projectName}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Summary*\n${payload.summary || '_no summary_'}` },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `${severityBadge} *${payload.severity}*` },
        { type: 'mrkdwn', text: `*Page:* \`${truncate(payload.pageUrl || 'unknown', 60)}\`` },
        { type: 'mrkdwn', text: `*ID:* \`${payload.reportId.slice(0, 8)}\u2026\`` },
      ],
    },
  ]

  if (reportUrl) {
    blocks.push({
      type: 'actions',
      block_id: `mushi_report_${payload.reportId}`,
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: 'Triage \u2192' },
          url: reportUrl,
          action_id: `open_report:${payload.reportId}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dispatch fix' },
          action_id: `dispatch_fix:${payload.reportId}`,
          value: payload.reportId,
          confirm: {
            title: { type: 'plain_text', text: 'Dispatch fix?' },
            text: { type: 'mrkdwn', text: 'This starts the auto-fix agent and opens a draft PR.' },
            confirm: { type: 'plain_text', text: 'Dispatch' },
            deny: { type: 'plain_text', text: 'Cancel' },
          },
        },
      ],
    })
  }

  return blocks
}

// ─── Legacy webhook path ──────────────────────────────────────────────────────

async function postToSlack(webhookUrl: string, body: object): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      slackLog.error('Webhook non-2xx', { status: res.status, body: text.slice(0, 400) })
    }
  } catch (err) {
    slackLog.error('Webhook delivery failed', { err: String(err) })
  }
}

export async function sendSlackNotification(webhookUrl: string, payload: SlackPayload): Promise<void> {
  if (isReportPayload(payload)) {
    const blocks = buildReportBlocks(payload)
    const fallback = `${payload.category} report in ${payload.projectName}: ${payload.summary}`
    await postToSlack(webhookUrl, { text: fallback, blocks })
    return
  }
  await postToSlack(webhookUrl, { text: payload.text })
}

/** Typed passthrough for plain-text callers (judge drift alerts, intelligence reports). */
export async function sendSlackText(webhookUrl: string, text: string): Promise<void> {
  await postToSlack(webhookUrl, { text })
}

// ─── Bot token path (chat.postMessage) ───────────────────────────────────────

export interface BotMessageOptions {
  /** Slack channel ID (e.g. C0B82A322RW). Falls back to SLACK_CHANNEL_ID env var. */
  channel?: string
  /** Block Kit blocks array. */
  blocks?: unknown[]
  /** Plain-text fallback (required by Slack if blocks are provided). */
  text: string
  /** When set, posts as a threaded reply to this message timestamp. */
  threadTs?: string | null
  /** Override the bot token. Falls back to SLACK_BOT_TOKEN env var. */
  token?: string
}

export interface BotMessageResult {
  ok: boolean
  /** The Slack message timestamp — store on the report for threading follow-ups. */
  ts: string | null
  error?: string
}

/**
 * Post a message via the Slack Bot API (`chat.postMessage`).
 * Returns `{ ok, ts }` — when `ok`, `ts` is the message's unique timestamp
 * which can be stored on the report row and used to post threaded replies.
 */
export async function sendBotMessage(opts: BotMessageOptions): Promise<BotMessageResult> {
  const token = opts.token ?? Deno.env.get('SLACK_BOT_TOKEN')
  const channel = opts.channel ?? Deno.env.get('SLACK_CHANNEL_ID')

  if (!token) {
    slackLog.warn('sendBotMessage: SLACK_BOT_TOKEN not set — skipping')
    return { ok: false, ts: null, error: 'no_bot_token' }
  }
  if (!channel) {
    slackLog.warn('sendBotMessage: no channel — skipping')
    return { ok: false, ts: null, error: 'no_channel' }
  }

  const body: Record<string, unknown> = {
    channel,
    text: opts.text,
  }
  if (opts.blocks?.length) body.blocks = opts.blocks
  if (opts.threadTs) body.thread_ts = opts.threadTs

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json() as { ok: boolean; ts?: string; error?: string }
    if (!json.ok) {
      slackLog.error('chat.postMessage failed', { slackError: json.error })
      return { ok: false, ts: null, error: json.error }
    }
    return { ok: true, ts: json.ts ?? null }
  } catch (err) {
    slackLog.error('chat.postMessage exception', { err: String(err) })
    return { ok: false, ts: null, error: String(err) }
  }
}

/**
 * Convenience wrapper: build report blocks and post via bot.
 * Falls back to webhook if no bot token is configured.
 * Returns the Slack message ts for threading (null when falling back to webhook).
 */
export async function sendReportNotification(
  payload: SlackReportPayload,
  opts: { channelId?: string; webhookUrl?: string },
): Promise<string | null> {
  const botToken = Deno.env.get('SLACK_BOT_TOKEN')
  if (botToken) {
    const blocks = buildReportBlocks(payload)
    const fallback = `${CATEGORY_EMOJI[payload.category] ?? '\u{1F41B}'} New ${payload.severity} ${payload.category} in ${payload.projectName}: ${payload.summary}`
    const result = await sendBotMessage({
      channel: opts.channelId ?? undefined,
      blocks,
      text: fallback,
    })
    return result.ts
  }
  // Legacy webhook fallback
  if (opts.webhookUrl) {
    const blocks = buildReportBlocks(payload)
    const fallback = `${payload.category} report in ${payload.projectName}: ${payload.summary}`
    await postToSlack(opts.webhookUrl, { text: fallback, blocks })
  }
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  return input.slice(0, max - 1) + '\u2026'
}
