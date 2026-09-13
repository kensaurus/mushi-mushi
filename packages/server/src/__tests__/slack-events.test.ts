/**
 * `api/routes/slack-events-core.ts` — Slack Events API + `/mushi` slash
 * command inbox for voice intake.
 *
 * Covers: url_verification handshake, signature gate, audio detection,
 * dedupe on the Slack file id, download → ingestVoice → threaded card with
 * voice_confirm / voice_cancel buttons, non-audio + bot messages ignored,
 * file_shared → files.info path, slash-command parsing and the list / open /
 * resolve / voice subcommands.
 *
 * `ingestVoice` is injected (SlackVoiceDeps); Slack's Web API and the
 * response_url are exercised through a stubbed global fetch; the database is
 * the in-memory fake in `__stubs__/fake-supabase.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => state.db,
  getUserClient: () => state.db,
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportError: vi.fn(),
  reportMessage: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/slack.ts', () => ({
  sendBotMessage: vi.fn(async () => ({ ok: true, ts: '1700000000.000100' })),
  buildReportDeepLink: (id: string, projectId?: string | null) =>
    `https://console.test/reports/${id}${projectId ? `?project=${projectId}` : ''}`,
}))
vi.mock('../../supabase/functions/_shared/report-transition.ts', () => ({
  applyReportStatusTransition: vi.fn(async () => ({ ok: true, previousStatus: 'new', storedStatus: 'fixed', changed: true })),
}))
vi.mock('../../supabase/functions/_shared/webhook-middleware.ts', () => {
  class ReplayAttackError extends Error {}
  class RateLimitError extends Error {}
  return {
    createWebhookMiddleware: () => ({
      audit: async () => ({ id: 'audit-row', resolve: async () => {}, setProject: async () => {} }),
      checkReplay: async () => {},
      checkRateLimit: () => {},
    }),
    ReplayAttackError,
    RateLimitError,
  }
})

type Core = typeof import('../../supabase/functions/api/routes/slack-events-core.ts')
type SlackVerify = typeof import('../../supabase/functions/_shared/slack-verify.ts')
type SlackMod = typeof import('../../supabase/functions/_shared/slack.ts')
type TransitionMod = typeof import('../../supabase/functions/_shared/report-transition.ts')

let core: Core
let verify: SlackVerify
let slack: SlackMod
let transition: TransitionMod

const SECRET = 'test-signing-secret'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const TEAM = 'T0TEAM'
const CHANNEL = 'C0CHAN'
const BOT_TOKEN = 'xoxb-test-token' // check-no-secrets: ignore-line — literal fixture, not a credential

const envBackup = { ...process.env }

beforeAll(async () => {
  process.env.SLACK_SIGNING_SECRET = SECRET
  process.env.SLACK_BOT_TOKEN = BOT_TOKEN
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  core = await import('../../supabase/functions/api/routes/slack-events-core.ts')
  verify = await import('../../supabase/functions/_shared/slack-verify.ts')
  slack = await import('../../supabase/functions/_shared/slack.ts')
  transition = await import('../../supabase/functions/_shared/report-transition.ts')
})

afterEach(() => {
  process.env = { ...envBackup, SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_TOKEN: BOT_TOKEN }
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ── helpers ──────────────────────────────────────────────────────────────────

function seededDb(extra: Record<string, Record<string, unknown>[]> = {}): FakeDb {
  const db = makeFakeDb({
    project_settings: [{ project_id: PROJECT, slack_team_id: TEAM, slack_channel_id: CHANNEL, slack_bot_token_ref: null }],
    voice_intake_sessions: [],
    reports: [],
    ...extra,
  })
  state.db = db
  return db
}

const awaitingResult = {
  sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  status: 'awaiting_confirm' as const,
  transcript: 'fix the login button on checkout',
  action: 'open_draft_pr',
  summary: 'Login button on checkout does nothing',
  confirmToken: 'tok_confirm_123',
  message: 'Confirm to dispatch',
}

function makeDeps(result: unknown = awaitingResult) {
  const ingestVoice = vi.fn(async () => result)
  return { deps: { ingestVoice: ingestVoice as never }, ingestVoice }
}

const AUDIO_FILE = {
  id: 'F0AUDIO1',
  name: 'clip.m4a',
  mimetype: 'audio/mp4',
  filetype: 'm4a',
  size: 12_345,
  duration_ms: 9_500,
  url_private_download: 'https://files.slack.com/files-pri/T0TEAM-F0AUDIO1/download/clip.m4a',
}

function stubSlackFetch(opts: { fileInfo?: unknown; audioBytes?: number; contentType?: string } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    if (url.startsWith('https://slack.com/api/files.info')) {
      return new Response(JSON.stringify({ ok: true, file: opts.fileInfo ?? AUDIO_FILE }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith('https://files.slack.com/')) {
      const bytes = new Uint8Array(opts.audioBytes ?? 64).fill(7)
      return new Response(bytes, {
        status: 200,
        headers: { 'content-type': opts.contentType ?? 'audio/mp4', 'content-length': String(bytes.length) },
      })
    }
    if (url.startsWith('https://hooks.slack.com/')) {
      return new Response('ok', { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

function messageEnvelope(overrides: Record<string, unknown> = {}, files: unknown[] = [AUDIO_FILE]) {
  return {
    type: 'event_callback',
    team_id: TEAM,
    event_id: 'Ev0001',
    event: {
      type: 'message',
      channel: CHANNEL,
      user: 'U0USER',
      ts: '1700000000.000001',
      text: '',
      files,
      ...overrides,
    },
  }
}

function fakeApp() {
  const routes: Record<string, (c: unknown) => Promise<Response>> = {}
  const app = {
    post: (path: string, ...handlers: Array<(c: unknown) => Promise<Response>>) => {
      routes[`POST ${path}`] = handlers[handlers.length - 1]
    },
    get: () => {},
    delete: () => {},
  }
  return { app: app as never, routes }
}

async function signedCtx(body: string, opts: { path?: string; timestamp?: string; signature?: string } = {}) {
  const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000))
  const sig = opts.signature ?? (await verify.computeSlackSignature(SECRET, ts, body))
  const headers: Record<string, string> = {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': sig,
  }
  const resHeaders: Record<string, string> = {}
  const ctx = {
    req: {
      text: async () => body,
      header: (name: string) => headers[name.toLowerCase()],
      method: 'POST',
      url: `https://edge.test/functions/v1/api${opts.path ?? '/v1/webhooks/slack/events'}`,
      path: opts.path ?? '/v1/webhooks/slack/events',
    },
    header: (k: string, v: string) => {
      resHeaders[k] = v
    },
    json: (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }),
    get: () => undefined,
    set: () => {},
  }
  return { ctx, resHeaders }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

describe('isSlackAudioFile', () => {
  it('detects audio by mimetype, filetype and Slack clip subtype', () => {
    expect(core.isSlackAudioFile({ mimetype: 'audio/mp4', filetype: 'm4a' })).toBe(true)
    expect(core.isSlackAudioFile({ mimetype: 'application/octet-stream', filetype: 'ogg' })).toBe(true)
    expect(core.isSlackAudioFile({ mimetype: 'audio/webm', filetype: 'webm' })).toBe(true)
    expect(core.isSlackAudioFile({ subtype: 'slack_audio', filetype: 'mp4' })).toBe(true)
  })
  it('rejects images, video clips and empty objects', () => {
    expect(core.isSlackAudioFile({ mimetype: 'image/png', filetype: 'png' })).toBe(false)
    expect(core.isSlackAudioFile({ mimetype: 'video/mp4', filetype: 'mp4' })).toBe(false)
    expect(core.isSlackAudioFile({ mimetype: 'text/plain', filetype: 'text' })).toBe(false)
    expect(core.isSlackAudioFile(null)).toBe(false)
  })
})

describe('parseMushiCommand', () => {
  it('parses every subcommand and falls back to help', () => {
    expect(core.parseMushiCommand('voice fix the login button')).toEqual({ sub: 'voice', text: 'fix the login button' })
    expect(core.parseMushiCommand('  list ')).toEqual({ sub: 'list' })
    expect(core.parseMushiCommand('open abc12345')).toEqual({ sub: 'open', id: 'abc12345' })
    expect(core.parseMushiCommand('resolve abc12345')).toEqual({ sub: 'resolve', id: 'abc12345' })
    expect(core.parseMushiCommand('')).toEqual({ sub: 'help' })
    expect(core.parseMushiCommand('dance')).toEqual({ sub: 'help' })
  })
  it('returns usage when an argument is missing', () => {
    expect(core.parseMushiCommand('voice')).toMatchObject({ sub: 'usage' })
    expect(core.parseMushiCommand('open')).toMatchObject({ sub: 'usage' })
    expect(core.parseMushiCommand('resolve')).toMatchObject({ sub: 'usage' })
  })
})

describe('buildVoiceResultMessage', () => {
  it('renders the verbatim transcript with confirm/cancel buttons carrying session:token', () => {
    const msg = core.buildVoiceResultMessage(awaitingResult as never)!
    expect(msg.blocks).toBeDefined()
    const actions = (msg.blocks as Array<{ type: string; block_id?: string; elements?: Array<{ action_id: string; value: string }> }>).find(
      (b) => b.type === 'actions',
    )!
    expect(actions.block_id).toBe(`mushi_voice_${awaitingResult.sessionId}`)
    expect(actions.elements!.map((e) => e.action_id)).toEqual(['voice_confirm', 'voice_cancel'])
    expect(actions.elements![0].value).toBe(`${awaitingResult.sessionId}:${awaitingResult.confirmToken}`)
    expect(JSON.stringify(msg.blocks)).toContain('fix the login button on checkout')
  })
  it('escapes mrkdwn control characters from the transcript', () => {
    const msg = core.buildVoiceResultMessage({ ...awaitingResult, transcript: 'a <b> & c' } as never)!
    expect(JSON.stringify(msg.blocks)).toContain('a &lt;b&gt; &amp; c')
  })
  it('returns null for duplicates and plain text for created/refused/failed', () => {
    expect(core.buildVoiceResultMessage({ ...awaitingResult, status: 'duplicate' } as never)).toBeNull()
    expect(core.buildVoiceResultMessage({ ...awaitingResult, status: 'created', reportId: 'r1', message: 'Report created' } as never)?.text).toContain('Report created')
    expect(core.buildVoiceResultMessage({ ...awaitingResult, status: 'refused', message: 'Privileged verb' } as never)?.text).toContain(':no_entry:')
    expect(core.buildVoiceResultMessage({ ...awaitingResult, status: 'failed', message: 'STT down' } as never)?.text).toContain(':x:')
  })
})

// ── events route ─────────────────────────────────────────────────────────────

describe('POST /v1/webhooks/slack/events', () => {
  it('answers the url_verification handshake with the challenge', async () => {
    seededDb()
    const { app, routes } = fakeApp()
    core.registerSlackEventsRoutesWith(app, makeDeps().deps)
    const body = JSON.stringify({ type: 'url_verification', challenge: 'chal-123', token: 'x' })
    const { ctx } = await signedCtx(body)
    const res = await routes['POST /v1/webhooks/slack/events'](ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'chal-123' })
  })

  it('rejects a bad signature with 401 and never touches the challenge', async () => {
    seededDb()
    const { app, routes } = fakeApp()
    core.registerSlackEventsRoutesWith(app, makeDeps().deps)
    const body = JSON.stringify({ type: 'url_verification', challenge: 'chal-123' })
    const { ctx } = await signedCtx(body, { signature: 'v0=' + '0'.repeat(64) })
    const res = await routes['POST /v1/webhooks/slack/events'](ctx)
    expect(res.status).toBe(401)
  })

  it('rejects a stale timestamp even with a matching MAC', async () => {
    seededDb()
    const { app, routes } = fakeApp()
    core.registerSlackEventsRoutesWith(app, makeDeps().deps)
    const body = JSON.stringify({ type: 'url_verification', challenge: 'chal' })
    const ts = String(Math.floor(Date.now() / 1000) - 3600)
    const { ctx } = await signedCtx(body, { timestamp: ts })
    const res = await routes['POST /v1/webhooks/slack/events'](ctx)
    expect(res.status).toBe(401)
  })

  it('acks event_callback immediately with X-Slack-No-Retry and returns 500 when the secret is unset', async () => {
    seededDb()
    const { app, routes } = fakeApp()
    core.registerSlackEventsRoutesWith(app, makeDeps().deps)
    stubSlackFetch()
    const body = JSON.stringify(messageEnvelope({}, []))
    const { ctx, resHeaders } = await signedCtx(body)
    const res = await routes['POST /v1/webhooks/slack/events'](ctx)
    expect(res.status).toBe(200)
    expect(resHeaders['X-Slack-No-Retry']).toBe('1')

    delete process.env.SLACK_SIGNING_SECRET
    const { ctx: ctx2 } = await signedCtx(body)
    const res2 = await routes['POST /v1/webhooks/slack/events'](ctx2)
    expect(res2.status).toBe(500)
  })
})

describe('processSlackEventEnvelope — message with audio', () => {
  it('downloads the clip with the bot token, ingests it and posts a threaded confirm card', async () => {
    const db = seededDb()
    const { calls } = stubSlackFetch()
    const { deps, ingestVoice } = makeDeps()

    await core.processSlackEventEnvelope(db as never, messageEnvelope() as never, deps)

    // download used the bot token against url_private_download
    const download = calls.find((c) => c.url.startsWith('https://files.slack.com/'))!
    expect(download).toBeDefined()
    expect((download.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${BOT_TOKEN}`)

    expect(ingestVoice).toHaveBeenCalledTimes(1)
    const input = ingestVoice.mock.calls[0][1] as Record<string, unknown>
    expect(input.projectId).toBe(PROJECT)
    expect(input.source).toBe('slack')
    expect(input.externalId).toBe('slack:file:F0AUDIO1')
    expect((input.audio as { mime: string; filename: string; bytes: Uint8Array; durationSec?: number }).mime).toBe('audio/mp4')
    expect((input.audio as { bytes: Uint8Array }).bytes.byteLength).toBe(64)
    expect((input.audio as { durationSec?: number }).durationSec).toBe(10)
    expect(input.channel).toEqual({ slackChannelId: CHANNEL, slackThreadTs: '1700000000.000001', slackUserId: 'U0USER' })

    expect(slack.sendBotMessage).toHaveBeenCalledTimes(1)
    const posted = (slack.sendBotMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(posted.channel).toBe(CHANNEL)
    expect(posted.threadTs).toBe('1700000000.000001')
    expect(posted.projectId).toBe(PROJECT)
    expect(JSON.stringify(posted.blocks)).toContain('"action_id":"voice_confirm"')
    expect(JSON.stringify(posted.blocks)).toContain('"action_id":"voice_cancel"')
    expect(JSON.stringify(posted.blocks)).toContain(`${awaitingResult.sessionId}:${awaitingResult.confirmToken}`)
  })

  it('threads under thread_ts when the clip is posted inside a thread', async () => {
    const db = seededDb()
    stubSlackFetch()
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(db as never, messageEnvelope({ thread_ts: '1699999999.000001' }) as never, deps)
    const input = ingestVoice.mock.calls[0][1] as { channel: { slackThreadTs: string } }
    expect(input.channel.slackThreadTs).toBe('1699999999.000001')
  })

  it('dedupes on the Slack file id: an existing session skips download and ingest', async () => {
    const db = seededDb({
      voice_intake_sessions: [{ id: 's1', project_id: PROJECT, external_id: 'slack:file:F0AUDIO1', status: 'awaiting_confirm' }],
    })
    const { fetchMock } = stubSlackFetch()
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(db as never, messageEnvelope() as never, deps)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ingestVoice).not.toHaveBeenCalled()
    expect(slack.sendBotMessage).not.toHaveBeenCalled()
  })

  it('ignores non-audio files, bot messages, edits and unconnected workspaces', async () => {
    const db = seededDb()
    const { fetchMock } = stubSlackFetch()
    const { deps, ingestVoice } = makeDeps()

    await core.processSlackEventEnvelope(
      db as never,
      messageEnvelope({}, [{ id: 'F0IMG', mimetype: 'image/png', filetype: 'png', url_private_download: 'https://files.slack.com/x.png' }]) as never,
      deps,
    )
    await core.processSlackEventEnvelope(db as never, messageEnvelope({ subtype: 'bot_message', bot_id: 'B1' }) as never, deps)
    await core.processSlackEventEnvelope(db as never, messageEnvelope({ subtype: 'message_changed' }) as never, deps)
    await core.processSlackEventEnvelope(db as never, { ...messageEnvelope(), team_id: 'T0OTHER', event: { ...messageEnvelope().event, channel: 'C0OTHER' } } as never, deps)
    await core.processSlackEventEnvelope(db as never, { ...messageEnvelope(), authorizations: [{ user_id: 'U0USER', is_bot: true }] } as never, deps)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(ingestVoice).not.toHaveBeenCalled()
  })

  it('posts a threaded error instead of ingesting when the download returns Slack’s HTML login page', async () => {
    const db = seededDb()
    stubSlackFetch({ contentType: 'text/html; charset=utf-8' })
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(db as never, messageEnvelope() as never, deps)
    expect(ingestVoice).not.toHaveBeenCalled()
    const posted = (slack.sendBotMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { text: string }
    expect(posted.text).toContain('files:read')
  })

  it('refuses clips over 25 MB before downloading', async () => {
    const db = seededDb()
    const { fetchMock } = stubSlackFetch()
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(
      db as never,
      messageEnvelope({}, [{ ...AUDIO_FILE, size: core.MAX_SLACK_AUDIO_BYTES + 1 }]) as never,
      deps,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ingestVoice).not.toHaveBeenCalled()
  })

  it('posts plain threaded replies for created / refused results', async () => {
    const db = seededDb()
    stubSlackFetch()
    const { deps } = makeDeps({ ...awaitingResult, status: 'refused', message: 'Voice requests cannot deploy or delete.' })
    await core.processSlackEventEnvelope(db as never, messageEnvelope() as never, deps)
    const posted = (slack.sendBotMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { text: string; blocks?: unknown[] }
    expect(posted.text).toContain(':no_entry:')
    expect(posted.text).toContain('fix the login button on checkout')
    expect(posted.blocks).toBeUndefined()
  })
})

describe('processSlackEventEnvelope — file_shared', () => {
  const sleep = async () => {}

  it('calls files.info, then ingests when the file is audio', async () => {
    const db = seededDb()
    const { calls } = stubSlackFetch({
      fileInfo: { ...AUDIO_FILE, shares: { public: { [CHANNEL]: [{ ts: '1700000000.000009' }] } } },
    })
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(
      db as never,
      { type: 'event_callback', team_id: TEAM, event_id: 'Ev0002', event: { type: 'file_shared', file_id: 'F0AUDIO1', channel_id: CHANNEL, user_id: 'U0USER' } } as never,
      deps,
      { sleep },
    )
    expect(calls.some((c) => c.url.startsWith('https://slack.com/api/files.info?file=F0AUDIO1'))).toBe(true)
    expect(ingestVoice).toHaveBeenCalledTimes(1)
    const input = ingestVoice.mock.calls[0][1] as { externalId: string; channel: { slackThreadTs?: string } }
    expect(input.externalId).toBe('slack:file:F0AUDIO1')
    expect(input.channel.slackThreadTs).toBe('1700000000.000009')
  })

  it('skips non-audio files after files.info', async () => {
    const db = seededDb()
    const { calls } = stubSlackFetch({ fileInfo: { id: 'F0DOC', mimetype: 'application/pdf', filetype: 'pdf', url_private_download: 'https://files.slack.com/doc.pdf' } })
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(
      db as never,
      { type: 'event_callback', team_id: TEAM, event_id: 'Ev0003', event: { type: 'file_shared', file_id: 'F0DOC', channel_id: CHANNEL } } as never,
      deps,
      { sleep },
    )
    expect(calls.filter((c) => c.url.startsWith('https://files.slack.com/'))).toHaveLength(0)
    expect(ingestVoice).not.toHaveBeenCalled()
  })

  it('does not double-ingest when the message path already claimed the file', async () => {
    const db = seededDb({
      voice_intake_sessions: [{ id: 's1', project_id: PROJECT, external_id: 'slack:file:F0AUDIO1' }],
    })
    const { fetchMock } = stubSlackFetch()
    const { deps, ingestVoice } = makeDeps()
    await core.processSlackEventEnvelope(
      db as never,
      { type: 'event_callback', team_id: TEAM, event_id: 'Ev0004', event: { type: 'file_shared', file_id: 'F0AUDIO1', channel_id: CHANNEL } } as never,
      deps,
      { sleep },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ingestVoice).not.toHaveBeenCalled()
  })
})

// ── slash commands ───────────────────────────────────────────────────────────

const REPORT_A = { id: 'aaaa1111-0000-4000-8000-000000000001', project_id: PROJECT, title: 'Checkout button dead', summary: 'Nothing happens', status: 'new', severity: 'high', created_at: '2026-09-12T01:00:00Z' }
const REPORT_B = { id: 'bbbb2222-0000-4000-8000-000000000002', project_id: PROJECT, title: 'Old fixed thing', summary: 'done', status: 'fixed', severity: 'low', created_at: '2026-09-11T01:00:00Z' }
const REPORT_C = { id: 'cccc3333-0000-4000-8000-000000000003', project_id: 'other-project', title: 'Not ours', summary: 'x', status: 'new', severity: 'low', created_at: '2026-09-12T02:00:00Z' }

function commandForm(text: string): string {
  return new URLSearchParams({
    command: '/mushi',
    text,
    user_id: 'U0USER',
    channel_id: CHANNEL,
    team_id: TEAM,
    response_url: 'https://hooks.slack.com/commands/T0TEAM/1/abc',
    trigger_id: '13345224609.738474920.8088930838d88f008e0',
  }).toString()
}

describe('runMushiCommand', () => {
  it('list: shows only this project’s open reports with console links', async () => {
    const db = seededDb({ reports: [REPORT_A, REPORT_B, REPORT_C] })
    const reply = await core.runMushiCommand(db as never, PROJECT, { sub: 'list' }, { user_id: 'U0USER' })
    expect(reply.response_type).toBe('ephemeral')
    expect(reply.text).toContain('Checkout button dead')
    expect(reply.text).not.toContain('Old fixed thing')
    expect(reply.text).not.toContain('Not ours')
    expect(reply.text).toContain(`https://console.test/reports/${REPORT_A.id}?project=${PROJECT}`)
  })

  it('open: resolves a prefix to a deep link and refuses cross-project ids', async () => {
    const db = seededDb({ reports: [REPORT_A, REPORT_B, REPORT_C] })
    const ok = await core.runMushiCommand(db as never, PROJECT, { sub: 'open', id: 'aaaa1111' }, { user_id: 'U0USER' })
    expect(ok.text).toContain('Checkout button dead')
    expect(ok.text).toContain(`https://console.test/reports/${REPORT_A.id}`)

    const foreign = await core.runMushiCommand(db as never, PROJECT, { sub: 'open', id: REPORT_C.id }, { user_id: 'U0USER' })
    expect(foreign.text).toContain('No report with that id')
  })

  it('resolve: goes through applyReportStatusTransition with the Slack actor', async () => {
    const db = seededDb({ reports: [REPORT_A] })
    const reply = await core.runMushiCommand(db as never, PROJECT, { sub: 'resolve', id: REPORT_A.id }, { user_id: 'U0USER' })
    expect(transition.applyReportStatusTransition).toHaveBeenCalledWith(db, {
      reportId: REPORT_A.id,
      requestedStatus: 'resolved',
      actor: { kind: 'slack', id: 'U0USER' },
    })
    expect(reply.text).toContain(':white_check_mark: Resolved')
  })

  it('help/usage: returns the reference text', async () => {
    const db = seededDb()
    const help = await core.runMushiCommand(db as never, PROJECT, { sub: 'help' }, { user_id: 'U' })
    expect(help.text).toContain('/mushi voice')
  })
})

describe('POST /v1/webhooks/slack/commands', () => {
  it('acks `/mushi voice …` within the handler and delivers the confirm card via response_url', async () => {
    seededDb()
    const { app, routes } = fakeApp()
    const { deps, ingestVoice } = makeDeps()
    core.registerSlackEventsRoutesWith(app, deps)
    const { calls } = stubSlackFetch()

    const body = commandForm('voice fix the login button')
    const { ctx } = await signedCtx(body, { path: '/v1/webhooks/slack/commands' })
    const res = await routes['POST /v1/webhooks/slack/commands'](ctx)
    expect(res.status).toBe(200)
    const ack = (await res.json()) as { response_type: string; text: string }
    expect(ack.response_type).toBe('ephemeral')

    // background work: let the microtask queue drain
    await new Promise((r) => setTimeout(r, 0))
    expect(ingestVoice).toHaveBeenCalledTimes(1)
    const input = ingestVoice.mock.calls[0][1] as Record<string, unknown>
    expect(input).toMatchObject({ projectId: PROJECT, source: 'slack', transcript: 'fix the login button' })
    expect(input.externalId).toBe('slack:cmd:13345224609.738474920.8088930838d88f008e0')

    const delivered = calls.find((c) => c.url.startsWith('https://hooks.slack.com/commands/'))!
    expect(delivered).toBeDefined()
    const payload = JSON.parse(delivered.init!.body as string) as { response_type: string; replace_original: boolean; blocks: unknown[] }
    expect(payload.response_type).toBe('ephemeral')
    expect(payload.replace_original).toBe(true)
    expect(JSON.stringify(payload.blocks)).toContain('"action_id":"voice_confirm"')
  })

  it('answers `/mushi list` synchronously and explains when the workspace is not connected', async () => {
    seededDb({ reports: [REPORT_A] })
    const { app, routes } = fakeApp()
    core.registerSlackEventsRoutesWith(app, makeDeps().deps)
    stubSlackFetch()

    const { ctx } = await signedCtx(commandForm('list'), { path: '/v1/webhooks/slack/commands' })
    const res = await routes['POST /v1/webhooks/slack/commands'](ctx)
    const reply = (await res.json()) as { text: string }
    expect(reply.text).toContain('Checkout button dead')

    const foreign = new URLSearchParams(commandForm('list'))
    foreign.set('team_id', 'T0STRANGER')
    foreign.set('channel_id', 'C0STRANGER')
    const { ctx: ctx2 } = await signedCtx(foreign.toString(), { path: '/v1/webhooks/slack/commands' })
    const res2 = await routes['POST /v1/webhooks/slack/commands'](ctx2)
    expect(((await res2.json()) as { text: string }).text).toContain('not connected')
  })

  it('rejects an unsigned slash command', async () => {
    seededDb()
    const { app, routes } = fakeApp()
    core.registerSlackEventsRoutesWith(app, makeDeps().deps)
    const { ctx } = await signedCtx(commandForm('list'), { path: '/v1/webhooks/slack/commands', signature: 'v0=' + 'f'.repeat(64) })
    const res = await routes['POST /v1/webhooks/slack/commands'](ctx)
    expect(res.status).toBe(401)
  })
})
