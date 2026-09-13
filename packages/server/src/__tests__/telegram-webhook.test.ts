/**
 * `telegram-webhook/handler.ts` — Telegram Bot API inbox for voice intake.
 *
 * Covers: secret-token gate (missing / wrong / right), `/start <code>` chat
 * binding (valid, expired, used, cross-project), unbound-chat refusal,
 * voice → downloadFile → ingestVoice with an inline Confirm/Cancel keyboard,
 * text → ingestVoice, update_id dedupe, callback_query confirm/cancel in
 * both the direct and lookup (>64-byte) callback_data forms, and the
 * always-200-after-auth contract.
 *
 * All Telegram + voice-intake helpers are injected (TelegramWebhookDeps); the
 * database is the in-memory fake in `__stubs__/fake-supabase.ts`.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

type Handler = typeof import('../../supabase/functions/telegram-webhook/handler.ts')
let handler: Handler

const PROJECT = '11111111-2222-4333-8444-555555555555'
const SECRET = 'telegram-secret-token-0123456789abcdef'
const SECRET_HASH = createHash('sha256').update(SECRET).digest('hex')
const CHAT_ID = 987654321
const USER_ID = 42
const WEBHOOK_URL = `https://edge.test/functions/v1/telegram-webhook?project=${PROJECT}`

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  handler = await import('../../supabase/functions/telegram-webhook/handler.ts')
})

// ── helpers ──────────────────────────────────────────────────────────────────

function seededDb(extra: Record<string, Record<string, unknown>[]> = {}, opts: { bound?: boolean } = { bound: true }): FakeDb {
  return makeFakeDb(
    {
      projects: [{ id: PROJECT, name: 'Acme Console' }],
      project_settings: [{ project_id: PROJECT, telegram_webhook_secret_hash: SECRET_HASH, telegram_bot_token_ref: 'vault-ref' }],
      telegram_chat_bindings: opts.bound ? [{ chat_id: String(CHAT_ID), project_id: PROJECT, bound_at: '2026-09-12T00:00:00Z' }] : [],
      telegram_bind_codes: [],
      voice_intake_sessions: [],
      ...extra,
    },
    { uniques: { telegram_bind_codes: ['code'], telegram_chat_bindings: ['chat_id', 'project_id'] } },
  )
}

const awaitingResult = {
  sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  status: 'awaiting_confirm' as const,
  transcript: 'ログインボタンを直して',
  action: 'open_draft_pr',
  summary: 'Fix the login button',
  confirmToken: 'tok',
  message: 'Confirm to dispatch',
}

function makeDeps(db: FakeDb, overrides: Partial<Handler['TelegramWebhookDeps']> = {}) {
  const background: Promise<unknown>[] = []
  const deps = {
    db: db as never,
    resolveBotToken: vi.fn(async () => 'bot-token'),
    sendMessage: vi.fn(async () => ({ ok: true })),
    downloadFile: vi.fn(async () => ({ bytes: new Uint8Array(32).fill(1), mime: 'audio/ogg', filename: 'voice.ogg', sizeBytes: 32 })),
    answerCallbackQuery: vi.fn(async () => ({ ok: true })),
    editMessageText: vi.fn(async () => ({ ok: true })),
    ingestVoice: vi.fn(async () => awaitingResult),
    confirmVoice: vi.fn(async () => ({ ok: true, status: 'dispatched', reportId: 'rep-1', dispatchId: 'd-1', message: 'Fix dispatched' })),
    cancelVoice: vi.fn(async () => ({ ok: true, message: 'Cancelled' })),
    waitUntil: (p: Promise<unknown>) => {
      background.push(p)
    },
    reportError: vi.fn(),
    adminBaseUrl: 'https://console.test',
    ...overrides,
  }
  return { deps: deps as unknown as Handler['TelegramWebhookDeps'], mocks: deps, drain: () => Promise.all(background) }
}

function request(body: unknown, opts: { secret?: string | null; url?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const secret = opts.secret === undefined ? SECRET : opts.secret
  if (secret) headers['x-telegram-bot-api-secret-token'] = secret
  const method = opts.method ?? 'POST'
  return new Request(opts.url ?? WEBHOOK_URL, {
    method,
    headers,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

let updateSeq = 1000
function message(overrides: Record<string, unknown> = {}, updateId = ++updateSeq) {
  return {
    update_id: updateId,
    message: {
      message_id: 77,
      from: { id: USER_ID, is_bot: false, first_name: 'Kenji' },
      chat: { id: CHAT_ID, type: 'private' },
      date: 1_757_635_200,
      ...overrides,
    },
  }
}

// ── auth gate ────────────────────────────────────────────────────────────────

describe('secret token gate', () => {
  it('rejects a missing or wrong X-Telegram-Bot-Api-Secret-Token with 401', async () => {
    const db = seededDb()
    const { deps, mocks } = makeDeps(db)
    expect((await handler.handleTelegramWebhook(request(message({ text: 'hi' }), { secret: null }), deps)).status).toBe(401)
    expect((await handler.handleTelegramWebhook(request(message({ text: 'hi' }), { secret: 'nope' }), deps)).status).toBe(401)
    expect(mocks.ingestVoice).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects when the project has no webhook secret configured', async () => {
    const db = seededDb({ project_settings: [{ project_id: PROJECT, telegram_webhook_secret_hash: null }] })
    const { deps } = makeDeps(db)
    expect((await handler.handleTelegramWebhook(request(message({ text: 'hi' })), deps)).status).toBe(401)
  })

  it('requires a valid ?project uuid and POST', async () => {
    const db = seededDb()
    const { deps } = makeDeps(db)
    expect((await handler.handleTelegramWebhook(request(message({ text: 'hi' }), { url: 'https://edge.test/functions/v1/telegram-webhook' }), deps)).status).toBe(400)
    expect((await handler.handleTelegramWebhook(request(message({ text: 'hi' }), { url: 'https://edge.test/functions/v1/telegram-webhook?project=nope' }), deps)).status).toBe(400)
    expect((await handler.handleTelegramWebhook(request('', { method: 'GET' }), deps)).status).toBe(405)
  })

  it('accepts the right secret and returns 200 for malformed JSON only after auth', async () => {
    const db = seededDb()
    const { deps } = makeDeps(db)
    expect((await handler.handleTelegramWebhook(request('not json'), deps)).status).toBe(400)
    const res = await handler.handleTelegramWebhook(request({ something: 'else' }), deps)
    expect(res.status).toBe(200)
  })
})

// ── /start binding ───────────────────────────────────────────────────────────

describe('/start <code> binding', () => {
  it('binds the chat, consumes the code and greets with the project name', async () => {
    const db = seededDb(
      { telegram_bind_codes: [{ code: 'AB23CD', project_id: PROJECT, created_by: 'u1', expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null }] },
      { bound: false },
    )
    const { deps, mocks } = makeDeps(db)
    const res = await handler.handleTelegramWebhook(request(message({ text: '/start ab23cd' })), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, data: { handled: 'start_bound' } })

    expect(db.tables.telegram_chat_bindings).toHaveLength(1)
    expect(db.tables.telegram_chat_bindings[0]).toMatchObject({ chat_id: String(CHAT_ID), project_id: PROJECT, bound_by_telegram_user_id: String(USER_ID) })
    expect(db.tables.telegram_bind_codes[0].used_at).toBeTruthy()
    const [projectId, chatId, text, opts] = mocks.sendMessage.mock.calls[0] as unknown as [string, string, string, { replyToMessageId?: number }]
    expect(projectId).toBe(PROJECT)
    expect(chatId).toBe(String(CHAT_ID))
    expect(text).toContain('Connected to Acme Console')
    expect(opts.replyToMessageId).toBe(77)
  })

  it('rejects expired, used, unknown and cross-project codes without binding', async () => {
    const past = new Date(Date.now() - 1_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    const db = seededDb(
      {
        telegram_bind_codes: [
          { code: 'EXPIRD', project_id: PROJECT, expires_at: past, used_at: null },
          { code: 'USEDUP', project_id: PROJECT, expires_at: future, used_at: past },
          { code: 'OTHERP', project_id: 'other-project', expires_at: future, used_at: null },
        ],
      },
      { bound: false },
    )
    const { deps, mocks } = makeDeps(db)
    for (const code of ['EXPIRD', 'USEDUP', 'OTHERP', 'NOPE99']) {
      const res = await handler.handleTelegramWebhook(request(message({ text: `/start ${code}` })), deps)
      expect(await res.json()).toMatchObject({ data: { handled: 'start_bad_code' } })
    }
    expect(db.tables.telegram_chat_bindings).toHaveLength(0)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(4)
    expect((mocks.sendMessage.mock.calls[0] as unknown as [string, string, string])[2]).toContain('invalid, expired or already used')
  })

  it('explains how to connect when /start has no code or the chat is unbound', async () => {
    const db = seededDb({}, { bound: false })
    const { deps, mocks } = makeDeps(db)
    await handler.handleTelegramWebhook(request(message({ text: '/start' })), deps)
    const res = await handler.handleTelegramWebhook(request(message({ voice: { file_id: 'v1', duration: 3, mime_type: 'audio/ogg' } })), deps)
    expect(await res.json()).toMatchObject({ data: { handled: 'unbound_chat' } })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
    for (const call of mocks.sendMessage.mock.calls) expect((call as unknown as [string, string, string])[2]).toContain('/start <code>')
    expect(mocks.ingestVoice).not.toHaveBeenCalled()
  })
})

// ── voice + text ingest ──────────────────────────────────────────────────────

describe('voice and text messages', () => {
  it('voice note → downloadFile → ingestVoice → transcript reply with inline keyboard', async () => {
    const db = seededDb()
    const { deps, mocks, drain } = makeDeps(db)
    const upd = message({ voice: { file_id: 'FILE_V1', file_unique_id: 'u', duration: 4, mime_type: 'audio/ogg', file_size: 32 } })
    const res = await handler.handleTelegramWebhook(request(upd), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, data: { handled: 'audio' } })
    await drain()

    expect(mocks.downloadFile).toHaveBeenCalledWith('bot-token', 'FILE_V1')
    expect(mocks.ingestVoice).toHaveBeenCalledTimes(1)
    const input = mocks.ingestVoice.mock.calls[0][1] as Record<string, unknown>
    expect(input).toMatchObject({ projectId: PROJECT, source: 'telegram', externalId: `telegram:${upd.update_id}` })
    expect(input.audio).toMatchObject({ mime: 'audio/ogg', filename: 'voice.ogg', durationSec: 4 })
    expect((input.audio as { bytes: Uint8Array }).bytes.byteLength).toBe(32)
    expect(input.channel).toEqual({ telegramChatId: String(CHAT_ID), telegramMessageId: 77 })

    const [, chatId, text, opts] = mocks.sendMessage.mock.calls[0] as unknown as [string, string, string, { replyToMessageId?: number; inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>> }]
    expect(chatId).toBe(String(CHAT_ID))
    expect(text).toContain('ログインボタンを直して')
    expect(text).toContain('open_draft_pr')
    expect(opts.replyToMessageId).toBe(77)
    expect(opts.inlineKeyboard).toEqual([
      [
        { text: '✅ Confirm', callback_data: `vc:${awaitingResult.sessionId}:tok` },
        { text: '✖ Cancel', callback_data: `vx:${awaitingResult.sessionId}:tok` },
      ],
    ])
  })

  it('plain text (not a command) is ingested as a transcript', async () => {
    const db = seededDb()
    const { deps, mocks, drain } = makeDeps(db)
    const upd = message({ text: 'add a loading spinner to the dashboard' })
    await handler.handleTelegramWebhook(request(upd), deps)
    await drain()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.ingestVoice.mock.calls[0][1]).toMatchObject({ transcript: 'add a loading spinner to the dashboard', externalId: `telegram:${upd.update_id}` })
  })

  it('dedupes on update_id when a session already exists', async () => {
    const upd = message({ voice: { file_id: 'FILE_V1', duration: 4 } })
    const db = seededDb({ voice_intake_sessions: [{ id: 's1', project_id: PROJECT, external_id: `telegram:${upd.update_id}` }] })
    const { deps, mocks, drain } = makeDeps(db)
    const res = await handler.handleTelegramWebhook(request(upd), deps)
    expect(await res.json()).toMatchObject({ data: { handled: 'audio', duplicate: true } })
    await drain()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.ingestVoice).not.toHaveBeenCalled()
  })

  it('replies with an error (no ingest) when the download fails, and still returns 200', async () => {
    const db = seededDb()
    const { deps, mocks, drain } = makeDeps(db, { downloadFile: vi.fn(async () => { throw new Error('file too big (>20 MB)') }) as never })
    const res = await handler.handleTelegramWebhook(request(message({ voice: { file_id: 'BIG', duration: 900 } })), deps)
    expect(res.status).toBe(200)
    await drain()
    expect(mocks.ingestVoice).not.toHaveBeenCalled()
    expect((mocks.sendMessage.mock.calls[0] as unknown as [string, string, string])[2]).toContain('file too big')
  })

  it('refused / created / failed results are relayed as plain text without a keyboard', async () => {
    const db = seededDb()
    const { deps, mocks, drain } = makeDeps(db, {
      ingestVoice: vi.fn(async () => ({ ...awaitingResult, status: 'refused', message: 'Voice requests cannot deploy.' })) as never,
    })
    await handler.handleTelegramWebhook(request(message({ text: 'deploy to production' })), deps)
    await drain()
    const [, , text, opts] = mocks.sendMessage.mock.calls[0] as unknown as [string, string, string, { inlineKeyboard?: unknown }]
    expect(text).toContain('⛔ Voice requests cannot deploy.')
    expect(text).toContain('ログインボタンを直して')
    expect(opts.inlineKeyboard).toBeUndefined()
  })

  it('ignores messages from bots and returns 200 when routing throws', async () => {
    const db = seededDb()
    const { deps, mocks } = makeDeps(db, { resolveBotToken: vi.fn(async () => { throw new Error('vault down') }) as never })
    const bot = await handler.handleTelegramWebhook(request(message({ text: 'hi', from: { id: 1, is_bot: true } })), deps)
    expect(await bot.json()).toMatchObject({ data: { handled: 'ignored_bot' } })

    const cb = await handler.handleTelegramWebhook(
      request({ update_id: 5, callback_query: { id: 'cbq', from: { id: USER_ID }, data: `vc:${awaitingResult.sessionId}:tok`, message: { message_id: 1, chat: { id: CHAT_ID, type: 'private' } } } }),
      deps,
    )
    expect(cb.status).toBe(200)
    expect(await cb.json()).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(mocks.reportError).toHaveBeenCalled()
  })
})

// ── callbacks ────────────────────────────────────────────────────────────────

describe('callback_query confirm / cancel', () => {
  function callback(data: string, updateId = ++updateSeq) {
    return {
      update_id: updateId,
      callback_query: {
        id: 'cbq-1',
        from: { id: USER_ID, first_name: 'Kenji' },
        data,
        message: { message_id: 78, chat: { id: CHAT_ID, type: 'private' }, text: '🎙 I heard: …' },
      },
    }
  }

  it('confirm (direct form) → confirmVoice, answerCallbackQuery, card edited in place', async () => {
    const db = seededDb()
    const { deps, mocks } = makeDeps(db)
    const res = await handler.handleTelegramWebhook(request(callback(`vc:${awaitingResult.sessionId}:tok`)), deps)
    expect(await res.json()).toMatchObject({ data: { handled: 'callback_confirm' } })
    expect(mocks.confirmVoice).toHaveBeenCalledWith(db, { sessionId: awaitingResult.sessionId, token: 'tok', actor: `telegram:${USER_ID}` })
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith('bot-token', 'cbq-1', 'Confirmed')
    const [, chatId, messageId, text] = mocks.editMessageText.mock.calls[0] as unknown as [string, string, number, string]
    expect(chatId).toBe(String(CHAT_ID))
    expect(messageId).toBe(78)
    expect(text).toContain('🎙 I heard')
    expect(text).toContain('✅ Confirmed — Fix dispatched')
    expect(text).toContain('https://console.test/reports/rep-1')
  })

  it('cancel → cancelVoice and the card shows the cancellation', async () => {
    const db = seededDb()
    const { deps, mocks } = makeDeps(db)
    await handler.handleTelegramWebhook(request(callback(`vx:${awaitingResult.sessionId}:tok`)), deps)
    expect(mocks.cancelVoice).toHaveBeenCalledWith(db, { sessionId: awaitingResult.sessionId, token: 'tok', actor: `telegram:${USER_ID}` })
    expect(mocks.confirmVoice).not.toHaveBeenCalled()
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith('bot-token', 'cbq-1', 'Cancelled')
    expect((mocks.editMessageText.mock.calls[0] as unknown as [string, string, number, string])[3]).toContain('🗑 Cancelled')
  })

  it('lookup form: resolves the session via channel.tg_cb and clears the stored token after use', async () => {
    const db = seededDb({
      voice_intake_sessions: [{ id: awaitingResult.sessionId, project_id: PROJECT, external_id: 'telegram:1', channel: { telegramChatId: String(CHAT_ID), tg_cb: 'LoOkUp1234567890', tg_token: 'long-token' } }],
    })
    const { deps, mocks } = makeDeps(db)
    await handler.handleTelegramWebhook(request(callback('vc:LoOkUp1234567890')), deps)
    expect(mocks.confirmVoice).toHaveBeenCalledWith(db, { sessionId: awaitingResult.sessionId, token: 'long-token', actor: `telegram:${USER_ID}` })
    expect((db.tables.voice_intake_sessions[0].channel as Record<string, unknown>).tg_token).toBeUndefined()
    expect((db.tables.voice_intake_sessions[0].channel as Record<string, unknown>).tg_cb).toBe('LoOkUp1234567890')
  })

  it('expired / unknown callbacks are answered, not thrown; failures surface in the card', async () => {
    const db = seededDb()
    const { deps, mocks } = makeDeps(db, { confirmVoice: vi.fn(async () => ({ ok: false, status: 'expired', message: 'Token expired' })) as never })
    await handler.handleTelegramWebhook(request(callback('vc:UnknownLookup99')), deps)
    expect(mocks.answerCallbackQuery).toHaveBeenLastCalledWith('bot-token', 'cbq-1', 'This confirmation has expired.')
    await handler.handleTelegramWebhook(request(callback('garbage')), deps)
    expect(mocks.answerCallbackQuery).toHaveBeenLastCalledWith('bot-token', 'cbq-1', 'Unknown action.')
    await handler.handleTelegramWebhook(request(callback(`vc:${awaitingResult.sessionId}:tok`)), deps)
    expect(mocks.answerCallbackQuery).toHaveBeenLastCalledWith('bot-token', 'cbq-1', 'Failed')
    expect((mocks.editMessageText.mock.calls[0] as unknown as [string, string, number, string])[3]).toContain('❌ Could not confirm — Token expired')
  })

  it('falls back to sendMessage when editMessageText fails', async () => {
    const db = seededDb()
    const { deps, mocks } = makeDeps(db, { editMessageText: vi.fn(async () => { throw new Error('message is not modified') }) as never })
    await handler.handleTelegramWebhook(request(callback(`vc:${awaitingResult.sessionId}:tok`)), deps)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect((mocks.sendMessage.mock.calls[0] as unknown as [string, string, string])[2]).toContain('✅ Confirmed')
  })
})

// ── keyboard sizing ──────────────────────────────────────────────────────────

describe('buildConfirmKeyboard', () => {
  it('uses the direct form when it fits in 64 bytes', async () => {
    const db = seededDb()
    const kb = await handler.buildConfirmKeyboard(db as never, { sessionId: awaitingResult.sessionId, confirmToken: 'short' })
    expect(kb[0][0].callback_data).toBe(`vc:${awaitingResult.sessionId}:short`)
    expect(new TextEncoder().encode(kb[0][0].callback_data).byteLength).toBeLessThanOrEqual(handler.TELEGRAM_CALLBACK_DATA_MAX_BYTES)
  })

  it('stores a 16-char lookup on the session when the token is too long', async () => {
    const longToken = 'x'.repeat(64)
    const db = seededDb({ voice_intake_sessions: [{ id: awaitingResult.sessionId, project_id: PROJECT, external_id: 'telegram:1', channel: { telegramChatId: '1' } }] })
    const kb = await handler.buildConfirmKeyboard(db as never, { sessionId: awaitingResult.sessionId, confirmToken: longToken })
    const data = kb[0][0].callback_data
    expect(data).toMatch(/^vc:[A-Za-z0-9]{16}$/)
    expect(kb[0][1].callback_data).toBe(data.replace(/^vc:/, 'vx:'))
    expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(handler.TELEGRAM_CALLBACK_DATA_MAX_BYTES)
    const channel = db.tables.voice_intake_sessions[0].channel as Record<string, unknown>
    expect(channel.tg_cb).toBe(data.slice(3))
    expect(channel.tg_token).toBe(longToken)
    expect(channel.telegramChatId).toBe('1')
  })
})
