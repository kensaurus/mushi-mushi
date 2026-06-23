/**
 * FILE: _shared/teams.ts
 * PURPOSE: Microsoft Teams incoming webhook notification helper.
 *
 * OVERVIEW:
 * Supports both the legacy "Connector card" format (used by Office 365
 * Connectors) and the newer Power Automate / Workflows webhook format.
 * Both accept a simple JSON body; the `@type: MessageCard` schema is the
 * lowest-common-denominator that works with both.
 *
 * DEPENDENCIES: None (Deno fetch)
 *
 * USAGE:
 *   await sendTeamsNotification(webhookUrl, { projectName, category, severity, summary, reportId })
 */

import { log } from './logger.ts'

const teamsLog = log.child('teams')

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'FF0000',
  high:     'FF6600',
  medium:   'FFCC00',
  low:      '00CC66',
}

export interface TeamsPayload {
  projectName: string
  category: string
  severity?: string
  summary?: string
  component?: string
  reportId: string
  reportUrl?: string
}

/**
 * Sends a structured MessageCard to a Microsoft Teams incoming webhook.
 * Compatible with both legacy Office 365 Connectors and Power Automate
 * "Post message in a chat or channel" webhooks.
 */
export async function sendTeamsNotification(
  webhookUrl: string,
  payload: TeamsPayload,
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) return { ok: false, error: 'no_webhook_url' }

  const adminBase = Deno.env.get('ADMIN_BASE_URL')?.replace(/\/$/, '') ?? null
  const reportUrl =
    payload.reportUrl ??
    (adminBase ? `${adminBase}/reports/${encodeURIComponent(payload.reportId)}` : null)

  const color = SEVERITY_COLORS[payload.severity ?? 'low'] ?? '7C3AED'

  const card: Record<string, unknown> = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: color,
    summary: `New ${payload.category} report in ${payload.projectName}`,
    sections: [
      {
        activityTitle: `🐛 New ${payload.category} report`,
        activitySubtitle: payload.projectName,
        activityText: payload.summary ?? 'No summary available',
        facts: [
          { name: 'Severity', value: payload.severity ?? 'unset' },
          { name: 'Component', value: payload.component ?? 'unknown' },
          { name: 'Report ID', value: payload.reportId.slice(0, 8) },
        ],
      },
    ],
  }

  if (reportUrl) {
    (card as Record<string, unknown>).potentialAction = [
      {
        '@type': 'OpenUri',
        name: 'View report',
        targets: [{ os: 'default', uri: reportUrl }],
      },
    ]
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    })
    if (res.ok || res.status === 200) return { ok: true }
    const body = await res.text().catch(() => '')
    teamsLog.warn('teams webhook error', { status: res.status, body: body.slice(0, 200) })
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * Sends a plain-text test message to a Teams webhook.
 * Used by the console "Send test" button.
 */
export async function sendTeamsTestMessage(
  webhookUrl: string,
  projectName: string,
): Promise<{ ok: boolean; error?: string }> {
  const card = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: '7C3AED',
    summary: `Mushi test — Teams is wired up for ${projectName}`,
    sections: [
      {
        activityTitle: '✅ Mushi test message',
        activityText: `Teams is wired up for **${projectName}**. You will receive report and QA alerts here.`,
      },
    ],
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    })
    if (res.ok || res.status === 200) return { ok: true }
    // SECURITY: never reflect the remote response body back to the caller.
    // The webhook URL is operator-supplied and fetched server-side; returning
    // the body would turn a misconfigured/internal URL into an SSRF exfil
    // channel. Surface the status code only (matches the Slack/Discord path).
    await res.body?.cancel().catch(() => {})
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
