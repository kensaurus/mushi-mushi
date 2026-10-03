/**
 * FILE: packages/server/supabase/functions/_shared/operator-digest-delivery.ts
 * PURPOSE: The live channels behind deliverDigest: Slack through a project's
 *          own Slack connection, email through Resend, and web push to the
 *          organization's owners' and admins' devices. Recipients are owners
 *          and admins only; emails are read from auth and never logged.
 */

import type { getServiceClient } from './db.ts'
import { sendBotMessage } from './slack.ts'
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

export const liveDeliveryDeps: DeliveryDeps = {
  async sendSlack(db: Db, projectId: string, text: string) {
    const { data } = await db.from('project_settings').select('slack_channel_id').eq('project_id', projectId).maybeSingle()
    const channel = (data as { slack_channel_id?: string | null } | null)?.slack_channel_id
    if (!channel) return { ok: false, error: 'that project has no Slack channel connected' }
    const r = await sendBotMessage({ db, projectId, channel, text })
    return { ok: r.ok, error: r.ok ? undefined : r.error ?? 'Slack refused the message' }
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
    const { data } = await db.from('organization_members').select('user_id, role').eq('organization_id', organizationId).in('role', ['owner', 'admin']).limit(20)
    const people = (data ?? []) as Array<{ user_id: string }>
    return Promise.all(people.map(async (m) => {
      const { data: u } = await db.auth.admin.getUserById(m.user_id)
      return { userId: m.user_id, email: u?.user?.email ?? null }
    }))
  },
}
