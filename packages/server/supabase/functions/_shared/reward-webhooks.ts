// ============================================================
// reward-webhooks.ts
//
// HMAC-signed delivery of reward events to host-registered
// webhook endpoints (reward_webhooks table).
//
// Each delivery:
//   - Signs the body with HMAC-SHA256 of the raw secret
//     (same "Stripe-style" format as plugin-dispatch).
//   - Posts with a 8-second timeout.
//   - Updates last_delivered_at + last_status on the row.
//   - Does NOT retry inline — the existing plugin-dispatch-retry
//     cron handles retries for failed deliveries logged here.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const wlog = log.child('reward-webhooks')
const TIMEOUT_MS = 8_000

export type RewardEventName =
  | 'reward.points_awarded'
  | 'reward.tier_changed'
  | 'reward.payout_requested'
  | 'reward.payout_paid'
  | 'reward.quest_completed'

export interface RewardEventPayload {
  event: RewardEventName
  end_user_id: string
  occurred_at: string
  [key: string]: unknown
}

async function sha256Hmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Loads the raw webhook secret (Workstream D2 — Vault-backed).
 *
 *  The `reward_webhooks.vault_secret_id` column holds a Vault reference to the
 *  raw HMAC signing secret (the value shown once at creation, API-key style).
 *  We dereference it server-side via the `vault_get_secret` RPC and never
 *  return it to clients. `secret_hash` is retained only for display/equality.
 *
 *  Backward-compat: if a webhook predates the vault column, fall back to the
 *  legacy per-id env var so existing deliveries keep signing.
 */
async function loadWebhookSecret(
  db: SupabaseClient,
  webhookId: string,
): Promise<string | null> {
  const { data: row, error } = await db
    .from('reward_webhooks')
    .select('vault_secret_id')
    .eq('id', webhookId)
    .maybeSingle()

  if (!error && row?.vault_secret_id) {
    const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', {
      secret_id: row.vault_secret_id as string,
    })
    if (vaultErr) {
      wlog.warn('vault_get_secret failed for reward webhook', { webhookId, error: vaultErr.message })
    } else if (typeof secret === 'string' && secret.length > 0) {
      return secret
    }
  }

  // Legacy fallback: MUSHI_REWARD_WEBHOOK_SECRET_<uppercased-id-no-dashes>.
  const envKey = `MUSHI_REWARD_WEBHOOK_SECRET_${webhookId.replace(/-/g, '').toUpperCase()}`
  return Deno.env.get(envKey) ?? null
}

export async function dispatchRewardWebhook(
  db: SupabaseClient,
  organizationId: string,
  payload: RewardEventPayload,
): Promise<void> {
  const { data: rows, error } = await db
    .from('reward_webhooks')
    .select('id, url, events')
    .eq('organization_id', organizationId)
    .eq('enabled', true)

  if (error) {
    wlog.warn('load_webhooks_failed', { organizationId, error: error.message })
    return
  }

  if (!rows?.length) return

  const matching = (rows as Array<{ id: string; url: string; events: string[] }>).filter(
    (r) => r.events.length === 0 || r.events.includes('*') || r.events.includes(payload.event),
  )

  await Promise.allSettled(matching.map((w) => deliverOne(db, w, payload)))
}

async function deliverOne(
  db: SupabaseClient,
  webhook: { id: string; url: string },
  payload: RewardEventPayload,
): Promise<void> {
  const body = JSON.stringify({ ...payload, webhookId: webhook.id })
  const secret = await loadWebhookSecret(db, webhook.id)
  const signature = secret ? `sha256=${await sha256Hmac(secret, body)}` : 'unsigned'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let status = 0

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Signature': signature,
        'X-Mushi-Event': payload.event,
        'X-Mushi-Delivery': crypto.randomUUID(),
      },
      body,
      signal: controller.signal,
    })
    status = res.status
  } catch (err) {
    wlog.warn('delivery_failed', { webhookId: webhook.id, url: webhook.url, error: String(err) })
    status = 0
  } finally {
    clearTimeout(timer)
  }

  await db
    .from('reward_webhooks')
    .update({
      last_delivered_at: new Date().toISOString(),
      last_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', webhook.id)
}
