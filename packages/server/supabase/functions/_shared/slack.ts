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

export async function sendSlackNotification(
  webhookUrl: string,
  payload: SlackReportPayload,
): Promise<void> {
  const severityEmoji: Record<string, string> = {
    critical: '\u{1F6A8}',
    high: '\u{1F534}',
    medium: '\u{1F7E1}',
    low: '\u{1F535}',
  }

  const categoryEmoji: Record<string, string> = {
    bug: '\u{26A0}\u{FE0F}',
    slow: '\u{1F40C}',
    visual: '\u{1F3A8}',
    confusing: '\u{1F615}',
    other: '\u{1F4DD}',
  }

  const text = [
    `${categoryEmoji[payload.category] ?? '\u{1F41B}'} *New bug report in ${payload.projectName}*`,
    `*Category:* ${payload.category} | *Severity:* ${severityEmoji[payload.severity] ?? ''} ${payload.severity}`,
    `*Summary:* ${payload.summary}`,
    `*Page:* ${payload.pageUrl || 'unknown'}`,
    `*Reporter:* \`${payload.reporterToken.slice(0, 16)}...\``,
  ].join('\n')

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    slackLog.error('Webhook delivery failed', { err: String(err) })
  }
}
