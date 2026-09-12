// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/api/routes/telegram-admin.ts
 * PURPOSE: Console-side management of the Telegram voice inbox (plan C1,
 *          "Telegram" adapter). The webhook itself lives in the
 *          `telegram-webhook` edge function; these routes only mint the
 *          chat-binding codes and register the webhook with Telegram.
 *
 *   POST   /v1/admin/telegram/bind-code         → { code, expires_at }
 *          One-time 6-char code the user sends to the bot as `/start <code>`
 *          (10-minute TTL, single use). Binds that chat to the project.
 *   POST   /v1/admin/telegram/setup             → { webhook_url }
 *          Requires `project_settings.telegram_bot_token_ref`. Generates a
 *          32-byte secret, stores its sha256 in
 *          `project_settings.telegram_webhook_secret_hash`, and calls
 *          Telegram `setWebhook` with the secret as `secret_token`. Telegram
 *          then sends it back on every update as
 *          `X-Telegram-Bot-Api-Secret-Token`, which the webhook verifies.
 *   GET    /v1/admin/telegram/status            → { configured, bindings }
 *   DELETE /v1/admin/telegram/bindings/:chatId  → { removed }
 *
 * AUTH: jwtAuth + `resolveOwnedProject` (owner / org member / project
 *       member), same as every other admin route. The project comes from
 *       `X-Mushi-Project-Id` (or `?project_id=`).
 *
 * The raw webhook secret is never persisted — only its hash. Rotating is a
 * matter of calling `setup` again.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log as rootLog } from '../../_shared/logger.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { resolveOwnedProject, jsonOk, jsonError, dbError } from '../shared.ts'
import { resolveTelegramBotToken, setTelegramWebhook } from '../../_shared/telegram.ts'

const log = rootLog.child('telegram-admin')

/** Unambiguous uppercase alphabet (no 0/O, 1/I). Codes are typed on a phone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const CODE_TTL_MS = 10 * 60 * 1000

export function mintBindCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return hex(new Uint8Array(digest))
}

/** 32 random bytes as hex — valid `secret_token` charset (A-Z a-z 0-9 _ -). */
export function mintWebhookSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return hex(bytes)
}

/** Public URL of the telegram-webhook function for this project. */
export function telegramWebhookUrl(projectId: string): string {
  const override = Deno.env.get('TELEGRAM_WEBHOOK_BASE_URL')?.replace(/\/$/, '')
  const base = override ?? `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1`
  return `${base}/telegram-webhook?project=${encodeURIComponent(projectId)}`
}

export function registerTelegramAdminRoutes(app: Hono<{ Variables: Variables }>): void {
  // ── POST /v1/admin/telegram/bind-code ───────────────────────────────────
  app.post('/v1/admin/telegram/bind-code', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response
    const projectId = resolved.project.id

    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
    // The code is the primary key; retry on the (astronomically rare) collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = mintBindCode()
      const { error } = await db.from('telegram_bind_codes').insert({
        code,
        project_id: projectId,
        created_by: userId,
        expires_at: expiresAt,
      })
      if (!error) {
        log.info('telegram bind code minted', { projectId, userId })
        return jsonOk(c, { code, expires_at: expiresAt })
      }
      if (error.code !== '23505') return dbError(c, error)
    }
    return jsonError(c, 'INTERNAL', 'Could not mint a unique code, try again', 500)
  })

  // ── POST /v1/admin/telegram/setup ───────────────────────────────────────
  app.post('/v1/admin/telegram/setup', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response
    const projectId = resolved.project.id

    const token = await resolveTelegramBotToken(db, projectId)
    if (!token) {
      return jsonError(
        c,
        'TELEGRAM_BOT_TOKEN_MISSING',
        'Save a Telegram bot token for this project first (project settings → Voice intake → Telegram).',
        400,
      )
    }

    const secret = mintWebhookSecret()
    const secretHash = await sha256Hex(secret)
    const { error: upsertErr } = await db
      .from('project_settings')
      .upsert({ project_id: projectId, telegram_webhook_secret_hash: secretHash }, { onConflict: 'project_id' })
    if (upsertErr) return dbError(c, upsertErr)

    const webhookUrl = telegramWebhookUrl(projectId)
    try {
      await setTelegramWebhook(token, webhookUrl, secret)
    } catch (err) {
      log.error('setWebhook failed', { projectId, err: String(err) })
      return jsonError(c, 'TELEGRAM_SET_WEBHOOK_FAILED', `Telegram rejected the webhook: ${String((err as Error).message ?? err)}`, 502)
    }

    log.info('telegram webhook registered', { projectId, userId })
    return jsonOk(c, { webhook_url: webhookUrl })
  })

  // ── GET /v1/admin/telegram/status ───────────────────────────────────────
  app.get('/v1/admin/telegram/status', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response
    const projectId = resolved.project.id

    const [{ data: settings, error: settingsErr }, { data: bindings, error: bindingsErr }] = await Promise.all([
      db
        .from('project_settings')
        .select('telegram_bot_token_ref, telegram_webhook_secret_hash')
        .eq('project_id', projectId)
        .maybeSingle(),
      db
        .from('telegram_chat_bindings')
        .select('chat_id, bound_at, bound_by_telegram_user_id')
        .eq('project_id', projectId)
        .order('bound_at', { ascending: false }),
    ])
    if (settingsErr) return dbError(c, settingsErr)
    if (bindingsErr) return dbError(c, bindingsErr)

    const s = (settings as { telegram_bot_token_ref?: string | null; telegram_webhook_secret_hash?: string | null } | null) ?? null
    return jsonOk(c, {
      configured: Boolean(s?.telegram_bot_token_ref) && Boolean(s?.telegram_webhook_secret_hash),
      bot_token_saved: Boolean(s?.telegram_bot_token_ref),
      webhook_registered: Boolean(s?.telegram_webhook_secret_hash),
      webhook_url: telegramWebhookUrl(projectId),
      bindings: ((bindings as Array<{ chat_id: string; bound_at: string; bound_by_telegram_user_id: string | null }> | null) ?? []).map(
        (b) => ({ chat_id: b.chat_id, bound_at: b.bound_at, bound_by: b.bound_by_telegram_user_id }),
      ),
    })
  })

  // ── DELETE /v1/admin/telegram/bindings/:chatId ──────────────────────────
  app.delete('/v1/admin/telegram/bindings/:chatId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const chatId = c.req.param('chatId')
    if (!chatId || chatId.length > 64) return jsonError(c, 'VALIDATION_ERROR', 'chatId required', 400)
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response
    const projectId = resolved.project.id

    const { data, error } = await db
      .from('telegram_chat_bindings')
      .delete()
      .eq('project_id', projectId)
      .eq('chat_id', chatId)
      .select('chat_id')
    if (error) return dbError(c, error)
    const removed = Array.isArray(data) ? data.length : 0
    log.info('telegram binding removed', { projectId, userId, chatId, removed })
    return jsonOk(c, { removed })
  })
}
