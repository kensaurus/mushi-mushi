import { log } from './logger.ts'

const discordLog = log.child('discord')

const SEVERITY_COLORS: Record<string, number> = {
  critical: 0xFF0000,
  high: 0xFF6600,
  medium: 0xFFCC00,
  low: 0x00CC66,
}

export interface DiscordPayload {
  projectName: string
  category: string
  severity?: string
  summary?: string
  component?: string
  reportId: string
  reportUrl?: string
}

export async function sendDiscordNotification(
  webhookUrl: string,
  payload: DiscordPayload,
): Promise<void> {
  const embed = {
    title: `New ${payload.category} report in ${payload.projectName}`,
    description: payload.summary ?? 'No summary available',
    fields: [
      { name: 'Severity', value: payload.severity ?? 'unset', inline: true },
      { name: 'Component', value: payload.component ?? 'unknown', inline: true },
      { name: 'Report ID', value: `\`${payload.reportId.slice(0, 8)}...\``, inline: true },
    ],
    color: SEVERITY_COLORS[payload.severity ?? 'low'] ?? 0x7C3AED,
    timestamp: new Date().toISOString(),
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  })

  if (!res.ok) {
    discordLog.error('Webhook failed', { status: res.status, body: await res.text() })
  }
}
