/**
 * FILE: packages/server/supabase/functions/_shared/slack.ts
 * PURPOSE: Slack delivery helper. Two things to know:
 *
 *   1. Payload drift is real. Four callers exist today — classify-report and
 *      fast-filter pass a structured "report" shape, while judge-batch and
 *      intelligence-report pass a plain `{ text }` shape. A single Slack
 *      function that silently accepts both produced the dreaded "unknown
 *      [Object object]" messages. This file now exposes two explicit
 *      entry points with typed overloads, and the legacy single-function
 *      signature still works for backward compat.
 *
 *   2. Rich Block Kit with action buttons. For report notifications we
 *      emit two buttons — `Triage →` opens the report in the admin, and
 *      `Dispatch fix` fires an `action_id=dispatch_fix:<report_id>` back
 *      at our `slack-interactions` Edge Function, which verifies the
 *      Slack signing secret and calls `fix-worker` just like the admin
 *      button does. When `ADMIN_BASE_URL` isn't set the buttons degrade
 *      to a plain link block — we never want Slack delivery to fail
 *      because of a missing env var.
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

function buildReportBlocks(payload: SlackReportPayload) {
  const base = adminBaseUrl()
  const reportUrl = base ? `${base}/reports?id=${encodeURIComponent(payload.reportId)}` : null
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
        { type: 'mrkdwn', text: `*Reporter:* \`${payload.reporterToken.slice(0, 12)}…\`` },
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

/** Typed passthrough for callers that only want to send plain text (judge
 *  drift alerts, weekly intelligence digests). Uses a disambiguated name
 *  so intent is obvious at the call site. */
export async function sendSlackText(webhookUrl: string, text: string): Promise<void> {
  await postToSlack(webhookUrl, { text })
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  return input.slice(0, max - 1) + '\u2026'
}
