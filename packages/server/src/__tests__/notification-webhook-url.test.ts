/**
 * Slack / Discord / Teams webhook URL validation (settings PATCH) and its
 * console mirror. Why: the Teams card accepted any https host, then the save
 * failed with the raw "teams_webhook_url: host is not an allowed webhook
 * provider". Refusals now read as plain sentences, and the console checks
 * the same host list before it saves.
 */
import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_WEBHOOK_HOSTS,
  isNotificationWebhookField,
  validateNotificationWebhookUrl,
} from '../../supabase/functions/_shared/notification-webhook-url.ts'
import { NOTIFICATION_WEBHOOK_HOSTS as ADMIN_HOSTS } from '../../../../apps/admin/src/lib/notificationWebhookHosts.ts'

describe('validateNotificationWebhookUrl', () => {
  it('accepts each provider host and its subdomains', () => {
    expect(validateNotificationWebhookUrl('slack_webhook_url', 'https://hooks.slack.com/services/T/B/x')).toEqual({ ok: true })
    expect(validateNotificationWebhookUrl('discord_webhook_url', 'https://discord.com/api/webhooks/1/abc')).toEqual({ ok: true })
    expect(validateNotificationWebhookUrl('teams_webhook_url', 'https://acme.webhook.office.com/webhookb2/x')).toEqual({ ok: true })
    expect(validateNotificationWebhookUrl('teams_webhook_url', 'https://prod-1.westus.logic.azure.com/workflows/x')).toEqual({ ok: true })
  })

  it('refuses another host with a sentence that names the provider, not the column', () => {
    const v = validateNotificationWebhookUrl('teams_webhook_url', 'https://example.com/hook')
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.message).toMatch(/Microsoft Teams/)
    expect(v.message).not.toMatch(/teams_webhook_url/)
  })

  it('refuses http and garbage', () => {
    expect(validateNotificationWebhookUrl('discord_webhook_url', 'http://discord.com/api/webhooks/1').ok).toBe(false)
    expect(validateNotificationWebhookUrl('discord_webhook_url', 'not a url').ok).toBe(false)
  })

  it('does not accept a look-alike suffix', () => {
    expect(validateNotificationWebhookUrl('slack_webhook_url', 'https://evilhooks.slack.com.attacker.io/x').ok).toBe(false)
    expect(validateNotificationWebhookUrl('discord_webhook_url', 'https://notdiscord.com/x').ok).toBe(false)
  })

  it('knows which settings fields are webhooks', () => {
    expect(isNotificationWebhookField('teams_webhook_url')).toBe(true)
    expect(isNotificationWebhookField('slack_channel_id')).toBe(false)
  })

  it('the console mirror lists the same hosts', () => {
    expect(ADMIN_HOSTS).toEqual(NOTIFICATION_WEBHOOK_HOSTS)
  })
})
