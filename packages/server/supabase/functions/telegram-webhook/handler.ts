// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/telegram-webhook/handler.ts
 * PURPOSE: Request handler for the Telegram voice inbox (plan C1, "Telegram"
 *          adapter). Kept free of Deno-only imports and side effects so the
 *          vitest suite can drive it with fake deps; `index.ts` wires the
 *          real `_shared/telegram.ts` + `_shared/voice-intake.ts` helpers.
 *
 * Flow per update:
 *   1. `?project=<uuid>` selects the tenant; the request is authenticated by
 *      `X-Telegram-Bot-Api-Secret-Token` (set via `setWebhook`), compared as
 *      sha256 against `project_settings.telegram_webhook_secret_hash` in
 *      constant time.
 *   2. `/start <code>` consumes a `telegram_bind_codes` row minted from the
 *      console and inserts a `telegram_chat_bindings` row. Every other update
 *      requires an existing binding for the chat.
 *   3. `message.voice` / `message.audio` → download (≤ 20 MB, enforced by
 *      the download helper) → `ingestVoice`. Plain `message.text` (not a
 *      command) → `ingestVoice` with the transcript. Dedupe key is
 *      `telegram:<update_id>` on `voice_intake_sessions.external_id`.
 *   4. An `awaiting_confirm` result is answered with the verbatim transcript
 *      and an inline keyboard. `callback_data` is capped at 64 bytes by
 *      Telegram, so when `vc:<session>:<token>` does not fit we store a
 *      16-char lookup id (+ the token) on the session's `channel` json and
 *      send `vc:<lookup>` instead; the token is cleared once used.
 *   5. `callback_query` → `confirmVoice` / `cancelVoice`, then
 *      `answerCallbackQuery` (mandatory, or the client spins) and the card is
 *      edited in place with the outcome.
 *
 * Telegram retries any non-2xx, so after authentication every path returns
 * 200 — processing errors are logged + reported, never surfaced as 5xx.
 * Audio ingestion runs under `waitUntil` so the ack is immediate.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import { constantTimeEqual } from '../_shared/slack-verify.ts'
import type { VoiceIngestInput, VoiceIngestResult } from '../_shared/voice-intake.ts'

const log = rootLog.child('telegram-webhook')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** Telegram hard limits. */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64
const TELEGRAM_MESSAGE_MAX_CHARS = 4096
const LOOKUP_ID_LENGTH = 16
const LOOKUP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// ── Telegram payload shapes (subset) ────────────────────────────────────────

export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel' | string
  title?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date?: number
  text?: string
  voice?: { file_id: string; file_unique_id?: string; duration?: number; mime_type?: string; file_size?: number }
  audio?: {
    file_id: string
    file_unique_id?: string
    duration?: number
    mime_type?: string
    file_name?: string
    file_size?: number
  }
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>

// ── Injected dependencies ───────────────────────────────────────────────────

export interface TelegramWebhookDeps {
  db: SupabaseClient
  resolveBotToken(projectId: string): Promise<string | null>
  sendMessage(
    projectId: string,
    chatId: string,
    text: string,
    opts?: { replyToMessageId?: number; inlineKeyboard?: InlineKeyboard; parseMode?: string },
  ): Promise<unknown>
  downloadFile(
    token: string,
    fileId: string,
  ): Promise<{ bytes: Uint8Array; mime: string; filename: string; sizeBytes: number }>
  answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<unknown>
  editMessageText(token: string, chatId: string, messageId: number, text: string): Promise<unknown>
  ingestVoice(db: SupabaseClient, input: VoiceIngestInput): Promise<VoiceIngestResult>
  confirmVoice(
    db: SupabaseClient,
    input: { sessionId: string; token: string; actor: string },
  ): Promise<{ ok: boolean; status: string; reportId?: string; dispatchId?: string; message: string }>
  cancelVoice(
    db: SupabaseClient,
    input: { sessionId: string; token: string; actor: string },
  ): Promise<{ ok: boolean; message: string }>
  /** Keep the isolate alive for deferred work. Defaults to EdgeRuntime.waitUntil. */
  waitUntil?(p: Promise<unknown>): void
  reportError?(err: unknown, ctx?: { tags?: Record<string, string> }): void
  /** Console base URL for report links (ADMIN_BASE_URL). */
  adminBaseUrl?: string | null
}

// ── Small helpers ───────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function randomLookupId(): string {
  const bytes = new Uint8Array(LOOKUP_ID_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += LOOKUP_ALPHABET[b % LOOKUP_ALPHABET.length]
  return out
}

const NOT_BOUND_TEXT =
  'This chat is not connected to a Mushi project yet.\n\n' +
  'Open the Mushi console → Settings → Voice intake → Telegram, generate a code, then send me:\n' +
  '/start <code>'

const HELP_TEXT =
  'Send me a voice note (or type a request) and I will transcribe it, propose an action and ask you to confirm before anything runs.\n\n' +
  '/start <code> — connect this chat to a project\n' +
  '/help — this message'

// ── Message text for intake outcomes ────────────────────────────────────────

export function buildVoiceReplyText(result: VoiceIngestResult, adminBaseUrl?: string | null): string | null {
  const transcript = truncate((result.transcript ?? '').trim(), 2500)
  switch (result.status) {
    case 'awaiting_confirm':
      return truncate(
        `🎙 I heard:\n\n“${transcript}”\n\n` +
          `Proposed action: ${result.action}\n${truncate(result.summary ?? '', 1000)}\n\n` +
          'Confirm within 10 minutes, or cancel.',
        TELEGRAM_MESSAGE_MAX_CHARS,
      )
    case 'created': {
      const base = (adminBaseUrl ?? '').replace(/\/$/, '')
      const link = result.reportId && base ? `\n${base}/reports/${encodeURIComponent(result.reportId)}` : ''
      return truncate(`✅ ${result.message}${link}`, TELEGRAM_MESSAGE_MAX_CHARS)
    }
    case 'refused':
      return truncate(`⛔ ${result.message}\n\n“${transcript}”`, TELEGRAM_MESSAGE_MAX_CHARS)
    case 'failed':
      return truncate(`❌ ${result.message}`, TELEGRAM_MESSAGE_MAX_CHARS)
    case 'duplicate':
      return null
    default:
      return truncate(result.message, TELEGRAM_MESSAGE_MAX_CHARS)
  }
}

/**
 * Build the Confirm/Cancel keyboard. Falls back to a stored lookup id when
 * the direct `vc:<session>:<token>` form exceeds Telegram's 64-byte cap.
 */
export async function buildConfirmKeyboard(
  db: SupabaseClient,
  result: Pick<VoiceIngestResult, 'sessionId' | 'confirmToken'>,
): Promise<InlineKeyboard> {
  const token = result.confirmToken ?? ''
  const direct = `${result.sessionId}:${token}`
  let suffix = direct
  if (utf8Bytes(`vc:${direct}`) > TELEGRAM_CALLBACK_DATA_MAX_BYTES) {
    const lookup = randomLookupId()
    const { data: row } = await db
      .from('voice_intake_sessions')
      .select('channel')
      .eq('id', result.sessionId)
      .maybeSingle()
    const channel = ((row as { channel?: Record<string, unknown> | null } | null)?.channel ?? {}) as Record<string, unknown>
    const { error } = await db
      .from('voice_intake_sessions')
      .update({ channel: { ...channel, tg_cb: lookup, tg_token: token } })
      .eq('id', result.sessionId)
    if (error) throw new Error(`could not store telegram callback lookup: ${error.message}`)
    suffix = lookup
  }
  return [
    [
      { text: '✅ Confirm', callback_data: `vc:${suffix}` },
      { text: '✖ Cancel', callback_data: `vx:${suffix}` },
    ],
  ]
}

async function resolveCallbackTarget(
  db: SupabaseClient,
  projectId: string,
  rest: string,
): Promise<{ sessionId: string; token: string; viaLookup: boolean } | null> {
  const idx = rest.indexOf(':')
  if (idx > 0) {
    const sessionId = rest.slice(0, idx)
    const token = rest.slice(idx + 1)
    if (!UUID_RE.test(sessionId) || !token) return null
    return { sessionId, token, viaLookup: false }
  }
  if (!/^[A-Za-z0-9]{8,32}$/.test(rest)) return null
  const { data } = await db
    .from('voice_intake_sessions')
    .select('id, channel')
    .eq('project_id', projectId)
    .eq('channel->>tg_cb', rest)
    .limit(1)
  const row = (data as Array<{ id: string; channel?: Record<string, unknown> | null }> | null)?.[0]
  const token = row?.channel?.tg_token
  if (!row || typeof token !== 'string' || !token) return null
  return { sessionId: row.id, token, viaLookup: true }
}

async function clearStoredToken(db: SupabaseClient, sessionId: string): Promise<void> {
  const { data: row } = await db.from('voice_intake_sessions').select('channel').eq('id', sessionId).maybeSingle()
  const channel = ((row as { channel?: Record<string, unknown> | null } | null)?.channel ?? {}) as Record<string, unknown>
  if (!('tg_token' in channel)) return
  const { tg_token: _drop, ...rest } = channel
  await db.from('voice_intake_sessions').update({ channel: rest }).eq('id', sessionId)
}

// ── DB helpers ──────────────────────────────────────────────────────────────

async function sessionExists(db: SupabaseClient, projectId: string, externalId: string): Promise<boolean> {
  const { data } = await db
    .from('voice_intake_sessions')
    .select('id')
    .eq('project_id', projectId)
    .eq('external_id', externalId)
    .limit(1)
  return Array.isArray(data) && data.length > 0
}

async function isChatBound(db: SupabaseClient, projectId: string, chatId: string): Promise<boolean> {
  const { data } = await db
    .from('telegram_chat_bindings')
    .select('chat_id')
    .eq('project_id', projectId)
    .eq('chat_id', chatId)
    .limit(1)
  return Array.isArray(data) && data.length > 0
}

// ── Update routing ──────────────────────────────────────────────────────────

export interface UpdateOutcome {
  handled: string
  duplicate?: boolean
}

async function handleStart(
  projectId: string,
  message: TelegramMessage,
  code: string | undefined,
  deps: TelegramWebhookDeps,
): Promise<UpdateOutcome> {
  const chatId = String(message.chat.id)
  const reply = (text: string) => deps.sendMessage(projectId, chatId, text, { replyToMessageId: message.message_id })

  if (!code) {
    await reply(NOT_BOUND_TEXT)
    return { handled: 'start_without_code' }
  }
  const normalized = code.trim().toUpperCase()
  const { data: row } = await deps.db
    .from('telegram_bind_codes')
    .select('code, project_id, used_at, expires_at')
    .eq('code', normalized)
    .eq('project_id', projectId)
    .maybeSingle()
  const bind = row as { code: string; used_at: string | null; expires_at: string } | null
  if (!bind || bind.used_at || new Date(bind.expires_at).getTime() < Date.now()) {
    await reply('That code is invalid, expired or already used. Generate a new one in the Mushi console (Voice intake → Telegram).')
    return { handled: 'start_bad_code' }
  }

  const { error: bindErr } = await deps.db.from('telegram_chat_bindings').upsert(
    {
      chat_id: chatId,
      project_id: projectId,
      bound_by_telegram_user_id: message.from ? String(message.from.id) : null,
      bound_at: new Date().toISOString(),
    },
    { onConflict: 'chat_id,project_id' },
  )
  if (bindErr) throw new Error(`telegram_chat_bindings.upsert: ${bindErr.message}`)
  await deps.db.from('telegram_bind_codes').update({ used_at: new Date().toISOString() }).eq('code', normalized)

  const { data: project } = await deps.db.from('projects').select('name').eq('id', projectId).maybeSingle()
  const name = (project as { name?: string | null } | null)?.name ?? 'your project'
  log.info('telegram chat bound', { projectId, chatId })
  await reply(`✅ Connected to ${name}.\n\nSend me a voice note or type what you want done — I will read it back and ask you to confirm.`)
  return { handled: 'start_bound' }
}

async function replyWithResult(
  projectId: string,
  message: TelegramMessage,
  result: VoiceIngestResult,
  deps: TelegramWebhookDeps,
): Promise<void> {
  const text = buildVoiceReplyText(result, deps.adminBaseUrl)
  if (!text) return
  const chatId = String(message.chat.id)
  const inlineKeyboard = result.status === 'awaiting_confirm' ? await buildConfirmKeyboard(deps.db, result) : undefined
  await deps.sendMessage(projectId, chatId, text, { replyToMessageId: message.message_id, inlineKeyboard })
}

async function ingestAudioMessage(
  projectId: string,
  update: TelegramUpdate,
  message: TelegramMessage,
  deps: TelegramWebhookDeps,
): Promise<void> {
  const chatId = String(message.chat.id)
  const media = message.voice ?? message.audio!
  const token = await deps.resolveBotToken(projectId)
  if (!token) {
    log.warn('no telegram bot token for project', { projectId })
    return
  }
  let file: Awaited<ReturnType<TelegramWebhookDeps['downloadFile']>>
  try {
    file = await deps.downloadFile(token, media.file_id)
  } catch (err) {
    log.error('telegram file download failed', { projectId, err: String(err) })
    await deps.sendMessage(projectId, chatId, `❌ I couldn't fetch that audio — ${String((err as Error).message ?? err)}`, {
      replyToMessageId: message.message_id,
    })
    return
  }
  const audioName = message.audio?.file_name
  const result = await deps.ingestVoice(deps.db, {
    projectId,
    source: 'telegram',
    externalId: `telegram:${update.update_id}`,
    audio: {
      bytes: file.bytes,
      mime: media.mime_type ?? file.mime,
      filename: audioName ?? file.filename,
      durationSec: media.duration,
    },
    channel: { telegramChatId: chatId, telegramMessageId: message.message_id },
  })
  await replyWithResult(projectId, message, result, deps)
}

async function ingestTextMessage(
  projectId: string,
  update: TelegramUpdate,
  message: TelegramMessage,
  text: string,
  deps: TelegramWebhookDeps,
): Promise<void> {
  const chatId = String(message.chat.id)
  const result = await deps.ingestVoice(deps.db, {
    projectId,
    source: 'telegram',
    externalId: `telegram:${update.update_id}`,
    transcript: text,
    channel: { telegramChatId: chatId, telegramMessageId: message.message_id },
  })
  await replyWithResult(projectId, message, result, deps)
}

async function handleCallback(
  projectId: string,
  cb: TelegramCallbackQuery,
  deps: TelegramWebhookDeps,
): Promise<UpdateOutcome> {
  const token = await deps.resolveBotToken(projectId)
  if (!token) {
    log.warn('no telegram bot token for project', { projectId })
    return { handled: 'callback_no_token' }
  }
  const answer = (text: string) =>
    deps.answerCallbackQuery(token, cb.id, text).catch((err) => log.warn('answerCallbackQuery failed', { err: String(err) }))

  const m = /^(vc|vx):(.+)$/.exec(cb.data ?? '')
  if (!m) {
    await answer('Unknown action.')
    return { handled: 'callback_unknown' }
  }
  const chatId = cb.message ? String(cb.message.chat.id) : null
  if (chatId && !(await isChatBound(deps.db, projectId, chatId))) {
    await answer('This chat is no longer connected.')
    return { handled: 'callback_unbound' }
  }

  const target = await resolveCallbackTarget(deps.db, projectId, m[2])
  if (!target) {
    await answer('This confirmation has expired.')
    return { handled: 'callback_expired' }
  }

  const actor = `telegram:${cb.from.id}`
  let outcome: string
  let ok: boolean
  if (m[1] === 'vc') {
    const res = await deps.confirmVoice(deps.db, { sessionId: target.sessionId, token: target.token, actor })
    ok = res.ok
    const base = (deps.adminBaseUrl ?? '').replace(/\/$/, '')
    const link = res.ok && res.reportId && base ? `\n${base}/reports/${encodeURIComponent(res.reportId)}` : ''
    outcome = res.ok ? `✅ Confirmed — ${res.message}${link}` : `❌ Could not confirm — ${res.message}`
  } else {
    const res = await deps.cancelVoice(deps.db, { sessionId: target.sessionId, token: target.token, actor })
    ok = res.ok
    outcome = res.ok ? `🗑 Cancelled — ${res.message}` : `❌ Could not cancel — ${res.message}`
  }
  if (target.viaLookup) await clearStoredToken(deps.db, target.sessionId).catch(() => {})

  await answer(ok ? (m[1] === 'vc' ? 'Confirmed' : 'Cancelled') : 'Failed')

  // Replace the card in place (drops the keyboard); fall back to a new message.
  if (cb.message && chatId) {
    const original = (cb.message.text ?? '').trim()
    const edited = truncate(original ? `${original}\n\n${outcome}` : outcome, TELEGRAM_MESSAGE_MAX_CHARS)
    try {
      await deps.editMessageText(token, chatId, cb.message.message_id, edited)
    } catch (err) {
      log.warn('editMessageText failed, sending a new message', { err: String(err) })
      await deps.sendMessage(projectId, chatId, outcome, { replyToMessageId: cb.message.message_id })
    }
  }
  return { handled: m[1] === 'vc' ? 'callback_confirm' : 'callback_cancel' }
}

function defaultWaitUntil(p: Promise<unknown>): void {
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') edgeRuntime.waitUntil(p)
}

/** Route one authenticated update. Exported for tests. */
export async function routeTelegramUpdate(
  projectId: string,
  update: TelegramUpdate,
  deps: TelegramWebhookDeps,
): Promise<UpdateOutcome> {
  if (update.callback_query) return handleCallback(projectId, update.callback_query, deps)

  const message = update.message
  if (!message || !message.chat) return { handled: 'ignored_unsupported' }
  if (message.from?.is_bot) return { handled: 'ignored_bot' }
  const chatId = String(message.chat.id)
  const text = (message.text ?? '').trim()

  const start = text ? /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text) : null
  if (start) return handleStart(projectId, message, start[1], deps)

  if (!(await isChatBound(deps.db, projectId, chatId))) {
    await deps.sendMessage(projectId, chatId, NOT_BOUND_TEXT, { replyToMessageId: message.message_id })
    return { handled: 'unbound_chat' }
  }

  if (message.voice || message.audio) {
    const externalId = `telegram:${update.update_id}`
    if (await sessionExists(deps.db, projectId, externalId)) return { handled: 'audio', duplicate: true }
    const work = ingestAudioMessage(projectId, update, message, deps).catch((err) => {
      log.error('telegram audio ingest failed', { projectId, updateId: update.update_id, err: String(err) })
      deps.reportError?.(err, { tags: { source: 'telegram-webhook', kind: 'audio' } })
    })
    ;(deps.waitUntil ?? defaultWaitUntil)(work)
    return { handled: 'audio' }
  }

  if (text.startsWith('/')) {
    if (/^\/help(?:@\w+)?$/i.test(text)) await deps.sendMessage(projectId, chatId, HELP_TEXT, { replyToMessageId: message.message_id })
    return { handled: 'command' }
  }

  if (text) {
    const externalId = `telegram:${update.update_id}`
    if (await sessionExists(deps.db, projectId, externalId)) return { handled: 'text', duplicate: true }
    const work = ingestTextMessage(projectId, update, message, text, deps).catch((err) => {
      log.error('telegram text ingest failed', { projectId, updateId: update.update_id, err: String(err) })
      deps.reportError?.(err, { tags: { source: 'telegram-webhook', kind: 'text' } })
    })
    ;(deps.waitUntil ?? defaultWaitUntil)(work)
    return { handled: 'text' }
  }

  return { handled: 'ignored_no_content' }
}

/** Full HTTP handler: auth, parse, route. */
export async function handleTelegramWebhook(req: Request, deps: TelegramWebhookDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }, 405)
  }
  const projectId = new URL(req.url).searchParams.get('project')
  if (!projectId || !UUID_RE.test(projectId)) {
    return json({ ok: false, error: { code: 'MISSING_PROJECT', message: '?project=<uuid> is required' } }, 400)
  }

  const { data: settings } = await deps.db
    .from('project_settings')
    .select('telegram_webhook_secret_hash')
    .eq('project_id', projectId)
    .maybeSingle()
  const storedHash = (settings as { telegram_webhook_secret_hash?: string | null } | null)?.telegram_webhook_secret_hash ?? null
  const presented = req.headers.get('x-telegram-bot-api-secret-token')
  if (!storedHash || !presented) {
    return json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret' } }, 401)
  }
  const presentedHash = await sha256Hex(presented)
  if (!constantTimeEqual(presentedHash, storedHash)) {
    log.warn('telegram webhook secret mismatch', { projectId })
    return json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret' } }, 401)
  }

  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return json({ ok: false, error: { code: 'BAD_JSON', message: 'Body is not JSON' } }, 400)
  }
  if (!update || typeof update.update_id !== 'number') {
    return json({ ok: true, data: { ignored: 'no_update_id' } })
  }

  try {
    const outcome = await routeTelegramUpdate(projectId, update, deps)
    return json({ ok: true, data: outcome })
  } catch (err) {
    // Never 5xx after auth — Telegram would retry the same update forever.
    log.error('telegram update failed', { projectId, updateId: update.update_id, err: String(err) })
    deps.reportError?.(err, { tags: { source: 'telegram-webhook' } })
    return json({ ok: false, error: { code: 'INTERNAL', message: 'Update could not be processed' } }, 200)
  }
}
