/**
 * FILE: packages/server/supabase/functions/_shared/operator-digest-delivery.ts
 * PURPOSE: The live channels behind deliverDigest: Slack, Discord, Teams and
 *          Telegram through a project's own existing connection (its bot or
 *          webhook, never a new credential), email through Resend, and web
 *          push to the organization's owners' and admins' devices. Recipients are owners
 *          and admins only; emails are read from auth and never logged.
 */

import type { getServiceClient } from './db.ts'
import { sendBotMessage, sendDiscordNotification } from './slack.ts'
import { sendTeamsText } from './teams.ts'
import { sendTelegramMessage } from './telegram.ts'
import { dereferenceMaybeVault } from './settings-secrets.ts'
import { sendTransactionalEmail } from './email.ts'
import { sendWebPushToUser } from './web-push.ts'
import type { DeliveryDeps } from './operator-digest.ts'

type Db = ReturnType<typeof getServiceClient>

/** Console link for the digest; ADMIN_BASE_URL wins when set. Read at call time (no module-level env). */
export function digestConsoleUrl(): string {
  let base = 'https://kensaur.us/mushi-mushi/admin'
  try {
    const env = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get('ADMIN_BASE_URL')
    if (env && /^https:\/\//.test(env)) base = env.replace(/\/$/, '')
  } catch {
    // No env access (tests): keep the public console URL.
  }
  return `${base}/portfolio`
}

const MAX_TELEGRAM_CHATS = 5

const WEBHOOK_LABEL = { discord_webhook_url: 'Discord', teams_webhook_url: 'Teams' } as const

/**
 * A project's Discord or Teams webhook URL, dereferenced when it is stored as
 * a Vault ref. A failed read is its own error, never "no webhook": the digest
 * must not blame a missing connection for a database or Vault failure.
 */
async function projectWebhook(
  db: Db,
  projectId: string,
  column: keyof typeof WEBHOOK_LABEL,
): Promise<{ url: string } | { url: null; error: string }> {
  const label = WEBHOOK_LABEL[column]
  const { data, error } = await db.from('project_settings').select(column).eq('project_id', projectId).maybeSingle()
  if (error) return { url: null, error: `that project's ${label} webhook could not be read` }
  const stored = (data as Record<string, string | null> | null)?.[column] ?? null
  if (!stored) return { url: null, error: `that project has no ${label} webhook` }
  const url = await dereferenceMaybeVault(db as never, stored)
  // A stored ref that dereferences to nothing is a Vault failure, not a missing webhook.
  if (!url) return { url: null, error: `that project's ${label} webhook could not be read from the vault` }
  return { url }
}

export const liveDeliveryDeps: DeliveryDeps = {
  async sendSlack(db: Db, projectId: string, text: string) {
    const { data, error } = await db.from('project_settings').select('slack_channel_id').eq('project_id', projectId).maybeSingle()
    if (error) return { ok: false, error: "that project's Slack channel could not be read" }
    const channel = (data as { slack_channel_id?: string | null } | null)?.slack_channel_id
    if (!channel) return { ok: false, error: 'that project has no Slack channel connected' }
    const r = await sendBotMessage({ db, projectId, channel, text })
    return { ok: r.ok, error: r.ok ? undefined : r.error ?? 'Slack refused the message' }
  },
  async sendDiscord(db: Db, projectId: string, title: string, body: string) {
    const hook = await projectWebhook(db, projectId, 'discord_webhook_url')
    if (hook.url === null) return { ok: false, error: hook.error }
    // Embed descriptions hold 4096 characters.
    return sendDiscordNotification(hook.url, body.slice(0, 4000), { title: title.slice(0, 250), color: 0x7c3aed })
  },
  async sendTeams(db: Db, projectId: string, title: string, body: string) {
    const hook = await projectWebhook(db, projectId, 'teams_webhook_url')
    if (hook.url === null) return { ok: false, error: hook.error }
    return sendTeamsText(hook.url, title, body)
  },
  async sendTelegram(db: Db, projectId: string, text: string) {
    const { data, error } = await db.from('telegram_chat_bindings').select('chat_id').eq('project_id', projectId).limit(MAX_TELEGRAM_CHATS)
    if (error) return { sent: 0, error: 'the Telegram chats could not be read' }
    const chats = (data ?? []) as Array<{ chat_id: string }>
    if (chats.length === 0) return { sent: 0, error: 'no Telegram chat is bound to that project' }
    let sent = 0
    let lastErr = ''
    for (const c of chats) {
      const r = await sendTelegramMessage(db as never, projectId, c.chat_id, text)
      if (r.ok) sent++
      else lastErr = r.description ?? 'Telegram refused the message'
    }
    return { sent, error: lastErr || undefined }
  },
  async sendEmail(to: string, subject: string, text: string) {
    const r = await sendTransactionalEmail({ to, subject, text, tags: { kind: 'operator_digest' } })
    return r.ok ? { ok: true } : { ok: false, error: r.reason }
  },
  async sendPush(db: Db, userId: string, title: string, body: string) {
    const r = await sendWebPushToUser(db as never, userId, { title, body, url: '/portfolio', tag: 'operator-digest' })
    return { sent: r.sent, error: r.error }
  },
  async adminRecipients(db: Db, organizationId: string) {
    const { data, error } = await db.from('organization_members').select('user_id, role').eq('organization_id', organizationId).in('role', ['owner', 'admin']).limit(20)
    if (error) throw new Error(error.message)
    const people = (data ?? []) as Array<{ user_id: string }>
    // One failed lookup marks that person only; the others still get the digest.
    return Promise.all(people.map(async (m) => {
      try {
        const { data: u, error: uErr } = await db.auth.admin.getUserById(m.user_id)
        if (uErr) return { userId: m.user_id, email: null, emailError: uErr.message }
        return { userId: m.user_id, email: u?.user?.email ?? null }
      } catch (e) {
        return { userId: m.user_id, email: null, emailError: String((e as Error)?.message ?? e) }
      }
    }))
  },
}
