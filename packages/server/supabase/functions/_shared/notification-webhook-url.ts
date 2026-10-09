/**
 * Slack / Discord / Teams webhook URL validation (SSRF guard).
 *
 * These URLs are saved through the settings PATCH route and later fetched
 * server-side with the service role (inside the provider network) by the
 * notification helpers, classify-report and fast-filter. Without a write-time
 * scheme + host allowlist an authenticated project member could point a
 * webhook at an internal address (cloud metadata, localhost, an internal
 * service) and turn the notification fetch into a blind SSRF probe. The
 * settings PATCH validates here, at its single write path, so every reader
 * can trust the stored value.
 *
 * The console mirrors NOTIFICATION_WEBHOOK_HOSTS in
 * apps/admin/src/lib/notificationWebhookHosts.ts so it can refuse a wrong
 * host before saving; notification-webhook-url.test.ts keeps the two equal.
 */

export const NOTIFICATION_WEBHOOK_HOSTS: Record<string, readonly string[]> = {
  slack_webhook_url: ['hooks.slack.com'],
  discord_webhook_url: ['discord.com', 'discordapp.com'],
  // Teams: legacy O365 connectors (*.webhook.office.com / outlook.office.com)
  // and Power Automate "When a Teams webhook request is received" triggers
  // (*.logic.azure.com / *.powerplatform.com).
  teams_webhook_url: ['office.com', 'logic.azure.com', 'powerplatform.com'],
}

const PROVIDER_NAME: Record<string, string> = {
  slack_webhook_url: 'Slack',
  discord_webhook_url: 'Discord',
  teams_webhook_url: 'Microsoft Teams',
}

export function isNotificationWebhookField(field: string): boolean {
  return field in NOTIFICATION_WEBHOOK_HOSTS
}

function isAllowedHost(hostname: string, suffixes: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`))
}

/**
 * Validate one webhook URL. A refusal carries a sentence the console shows as
 * is: it names the provider, never the column, and says what to paste.
 */
export function validateNotificationWebhookUrl(
  field: string,
  raw: string,
): { ok: true } | { ok: false; message: string } {
  const name = PROVIDER_NAME[field] ?? 'webhook'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: `That is not a valid URL. Copy the ${name} webhook URL again and paste all of it.` }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, message: `${name} webhook URLs start with https://. Copy the URL again from ${name}.` }
  }
  const suffixes = NOTIFICATION_WEBHOOK_HOSTS[field]
  if (suffixes && !isAllowedHost(url.hostname, suffixes)) {
    return {
      ok: false,
      message: `That is not a ${name} webhook URL. It must be on ${suffixes.join(' or ')}; copy it from ${name}'s webhook settings.`,
    }
  }
  return { ok: true }
}
