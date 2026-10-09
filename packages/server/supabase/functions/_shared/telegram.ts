// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/telegram.ts
 * PURPOSE: Minimal Telegram Bot API client for the voice inbox (plan C1
 *          "Telegram", C5). Telegram is the Android answer: there is no
 *          public path for a third-party app to receive Assistant voice text,
 *          so a bot chat is the inbox and voice notes (ogg/opus) are the
 *          payload.
 *
 * Security notes:
 *   - The bot token is a per-project secret resolved from Vault
 *     (`project_settings.telegram_bot_token_ref`, `vault://<name>`), exactly
 *     the way `_shared/byok.ts` dereferences BYOK keys. Raw tokens in the
 *     column are tolerated only outside production, mirroring byok.ts.
 *   - The token is part of every Bot API URL. No helper here ever logs a
 *     URL or includes one in an error message — errors carry the method
 *     name and Telegram's `description` only.
 *   - Downloads are capped at 20 MB (Telegram's own getFile ceiling) and go
 *     through `fetchWithTimeout`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { fetchWithTimeout } from './http.ts'
import { extensionForMime, mimeForExtension, normalizeAudioFilename, type AudioExtension } from './stt.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('telegram')

const TELEGRAM_API_BASE = 'https://api.telegram.org'
/** Bot API getFile refuses files above 20 MB; enforce the same cap on our side. */
export const TELEGRAM_MAX_FILE_BYTES = 20 * 1024 * 1024
const TELEGRAM_TIMEOUT_MS = 10_000
const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 20_000

export interface TelegramApiResponse<T = unknown> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | null,
    description: string,
  ) {
    super(`Telegram ${method} failed: ${description}`)
    this.name = 'TelegramApiError'
  }
}

let warnedRawToken = false

/**
 * Resolve the project's bot token from Vault. Returns null when the project
 * has not connected a bot. Never throws — callers treat null as "Telegram
 * not configured".
 */
export async function resolveTelegramBotToken(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await db
    .from('project_settings')
    .select('telegram_bot_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) {
    log.warn('telegram_bot_token_ref lookup failed', { projectId, err: error.message })
    return null
  }
  const ref = (data as { telegram_bot_token_ref?: string | null } | null)?.telegram_bot_token_ref ?? null
  if (!ref) return null

  if (ref.startsWith('vault://')) {
    const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', {
      secret_id: ref.slice('vault://'.length),
    })
    if (vaultErr) {
      log.warn('vault_get_secret failed for telegram bot token', { projectId, err: vaultErr.message })
      return null
    }
    return typeof secret === 'string' && secret.length > 0 ? secret : null
  }

  // Raw token in the column — only tolerated outside production (same rule as byok.ts).
  const env = Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('NODE_ENV') ?? ''
  if (env === 'production' || env === 'prod') {
    log.error('telegram_bot_token_ref holds a raw token in production — use vault://<name>', { projectId })
    return null
  }
  if (!warnedRawToken) {
    warnedRawToken = true
    log.warn('telegram_bot_token_ref is a raw token; allowed only in dev/staging', { projectId })
  }
  return ref
}

/**
 * Call one Bot API method. Resolves with Telegram's envelope (`ok`,
 * `result`, `description`) — a Telegram-level failure (`ok: false`) is
 * returned, not thrown, so chat handlers can degrade gracefully; only
 * transport failures (timeout, DNS) reject.
 */
export async function telegramApi<T = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<TelegramApiResponse<T>> {
  const res = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/bot${token}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    TELEGRAM_TIMEOUT_MS,
  )
  const json = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null
  if (!json) {
    return { ok: false, error_code: res.status, description: `non-JSON response (${res.status})` }
  }
  if (!json.ok) {
    log.warn('telegram api error', { method, errorCode: json.error_code ?? res.status, description: json.description })
  }
  return json
}

export type TelegramParseMode = 'MarkdownV2' | 'HTML'

export interface SendTelegramMessageOptions {
  replyToMessageId?: number
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
  /** Only 'MarkdownV2' | 'HTML' are forwarded; anything else sends plain text. */
  parseMode?: TelegramParseMode | (string & {})
}

function normalizeParseMode(mode: string | undefined): TelegramParseMode | null {
  return mode === 'MarkdownV2' || mode === 'HTML' ? mode : null
}

/**
 * Send a text message to a chat with the project's bot. Returns Telegram's
 * envelope; `{ ok: false, description: 'no_bot_token' }` when the project has
 * no bot connected. Text is clipped to Telegram's 4096-character limit.
 */
export async function sendTelegramMessage(
  db: SupabaseClient,
  projectId: string,
  chatId: string,
  text: string,
  opts: SendTelegramMessageOptions = {},
): Promise<TelegramApiResponse<{ message_id: number }>> {
  const token = await resolveTelegramBotToken(db, projectId)
  if (!token) return { ok: false, description: 'no_bot_token' }
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4096),
  }
  if (opts.replyToMessageId !== undefined) {
    body.reply_parameters = { message_id: opts.replyToMessageId, allow_sending_without_reply: true }
  }
  if (opts.inlineKeyboard?.length) body.reply_markup = { inline_keyboard: opts.inlineKeyboard }
  const parseMode = normalizeParseMode(opts.parseMode)
  if (parseMode) body.parse_mode = parseMode
  return telegramApi<{ message_id: number }>(token, 'sendMessage', body)
}

interface TelegramFile {
  file_id: string
  file_unique_id?: string
  file_size?: number
  file_path?: string
}

function extensionFromPath(path: string): AudioExtension | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'oga':
    case 'ogg':
    case 'opus':
      return 'ogg'
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'm4a'
    case 'mp3':
      return 'mp3'
    case 'webm':
      return 'webm'
    case 'wav':
      return 'wav'
    default:
      return null
  }
}

/**
 * getFile → download. Telegram voice notes are ogg/opus (`voice.oga`);
 * shared audio files keep their own container. The returned filename always
 * carries the extension matching `mime`, which is what `transcribeAudio`
 * needs on the multipart part.
 */
export async function downloadTelegramFile(
  token: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string; filename: string; sizeBytes: number }> {
  const meta = await telegramApi<TelegramFile>(token, 'getFile', { file_id: fileId })
  if (!meta.ok || !meta.result?.file_path) {
    throw new TelegramApiError('getFile', meta.error_code ?? null, meta.description ?? 'no file_path in response')
  }
  if ((meta.result.file_size ?? 0) > TELEGRAM_MAX_FILE_BYTES) {
    throw new TelegramApiError('getFile', null, `file exceeds ${TELEGRAM_MAX_FILE_BYTES / (1024 * 1024)} MB`)
  }

  const filePath = meta.result.file_path
  const res = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`,
    { method: 'GET' },
    TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  )
  if (!res.ok) {
    throw new TelegramApiError('file', res.status, `download returned ${res.status}`)
  }
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > TELEGRAM_MAX_FILE_BYTES) {
    throw new TelegramApiError('file', null, `file exceeds ${TELEGRAM_MAX_FILE_BYTES / (1024 * 1024)} MB`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > TELEGRAM_MAX_FILE_BYTES) {
    throw new TelegramApiError('file', null, `file exceeds ${TELEGRAM_MAX_FILE_BYTES / (1024 * 1024)} MB`)
  }

  const ext =
    extensionFromPath(filePath) ??
    extensionForMime(res.headers.get('content-type')) ??
    'ogg'
  return {
    bytes,
    mime: mimeForExtension(ext),
    filename: normalizeAudioFilename(filePath.split('/').pop() ?? 'voice', ext),
    sizeBytes: bytes.byteLength,
  }
}

/** Acknowledge an inline-keyboard tap (clears the client's spinner). */
export function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<TelegramApiResponse<boolean>> {
  return telegramApi<boolean>(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200) } : {}),
  })
}

/**
 * Register (or re-point) the bot's webhook. `secretToken` is echoed by
 * Telegram in `X-Telegram-Bot-Api-Secret-Token` on every update; the
 * telegram-webhook function compares its sha256 against
 * `project_settings.telegram_webhook_secret_hash`.
 */
export function setTelegramWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<TelegramApiResponse<boolean>> {
  return telegramApi<boolean>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  })
}
