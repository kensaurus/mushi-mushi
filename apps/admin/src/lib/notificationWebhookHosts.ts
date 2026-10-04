/**
 * FILE: apps/admin/src/lib/notificationWebhookHosts.ts
 * PURPOSE: The webhook hosts the settings PATCH accepts for Slack, Discord
 *          and Teams, so a card can refuse a wrong URL before saving.
 *
 * Mirror of NOTIFICATION_WEBHOOK_HOSTS in
 * packages/server/supabase/functions/_shared/notification-webhook-url.ts;
 * packages/server/src/__tests__/notification-webhook-url.test.ts keeps the
 * two equal.
 */

export const NOTIFICATION_WEBHOOK_HOSTS: Record<string, readonly string[]> = {
  slack_webhook_url: ['hooks.slack.com'],
  discord_webhook_url: ['discord.com', 'discordapp.com'],
  teams_webhook_url: ['office.com', 'logic.azure.com', 'powerplatform.com'],
}

/** True when `hostname` is one of `field`'s provider hosts or a subdomain of one. */
export function isNotificationWebhookHost(field: keyof typeof NOTIFICATION_WEBHOOK_HOSTS, hostname: string): boolean {
  const suffixes = NOTIFICATION_WEBHOOK_HOSTS[field] ?? []
  const host = hostname.toLowerCase()
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`))
}
