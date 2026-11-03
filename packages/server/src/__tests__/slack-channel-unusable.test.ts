/**
 * A Slack channel that cannot take posts is a setup gap, not an error.
 *
 * MUSHI-MUSHI-SERVER-3A (2026-10-31): glot.it, the-wanting-mind and yen-yen
 * store channel C0B82A322RW, which the operator bot cannot find. Every send
 * logged `chat.postMessage failed` (426 Sentry errors in four days) while
 * the Slack health card said "ok", because the probe only ran auth.test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logged = vi.hoisted(() => ({ warn: [] as string[], error: [] as string[] }))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = {
    info: () => {},
    debug: () => {},
    warn: (msg: string) => logged.warn.push(msg),
    error: (msg: string) => logged.error.push(msg),
    child: () => l,
  }
  return { log: l }
})

const OPERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OPERATOR_PROJECT = '11111111-1111-4111-8111-111111111111'

/** Only `projects.owner_id` is read (operator gate). */
function fakeDb() {
  return {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({ data: id === OPERATOR_PROJECT ? { owner_id: OPERATOR } : null, error: null }),
        }),
      }),
    }),
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  logged.warn.length = 0
  logged.error.length = 0
  vi.stubGlobal('Deno', {
    env: {
      get: (k: string) =>
        ({ MUSHI_OPERATOR_USER_IDS: OPERATOR, SLACK_BOT_TOKEN: 'fake-bot-token' })[k],
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('sendBotMessage on a channel Slack refuses', () => {
  it('logs a warn, not an error, and skips the channel on the next send in this worker', async () => {
    const fetchMock = vi.fn(async () => json({ ok: false, error: 'channel_not_found' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const slack = await import('../../supabase/functions/_shared/slack.ts')

    const first = await slack.sendBotMessage({ token: 'fake-bot-token', channel: 'C0B82A322RW', text: 'hi' })
    expect(first).toEqual({ ok: false, ts: null, error: 'channel_not_found' })
    const second = await slack.sendBotMessage({ token: 'fake-bot-token', channel: 'C0B82A322RW', text: 'hi' })
    expect(second).toEqual({ ok: false, ts: null, error: 'channel_not_found' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logged.error).toEqual([])
    expect(logged.warn).toHaveLength(1)

    // Another channel is still tried.
    await slack.sendBotMessage({ token: 'fake-bot-token', channel: 'C_OTHER', text: 'hi' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still logs any other Slack error at error level', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, error: 'invalid_blocks' })))
    vi.resetModules()
    const slack = await import('../../supabase/functions/_shared/slack.ts')
    await slack.sendBotMessage({ token: 'fake-bot-token', channel: 'C1', text: 'hi' })
    expect(logged.error).toContain('chat.postMessage failed')
  })

  it('classifies only the channel errors as unusable', async () => {
    vi.resetModules()
    const { isSlackChannelUnusable } = await import('../../supabase/functions/_shared/slack.ts')
    for (const e of ['channel_not_found', 'is_archived', 'not_in_channel']) expect(isSlackChannelUnusable(e)).toBe(true)
    for (const e of ['invalid_auth', 'ratelimited', 'missing_scope', undefined, null, '']) {
      expect(isSlackChannelUnusable(e)).toBe(false)
    }
  })
})

describe('Slack health probe checks the stored channel', () => {
  async function probe(channelReply: unknown, channel: string | null = 'C0B82A322RW') {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('auth.test')) return json({ ok: true, team: 'sakuraAppWorks', bot_id: 'B1' })
      return json(channelReply)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { probeIntegration } = await import('../../supabase/functions/_shared/integration-probes.ts')
    const result = await probeIntegration('slack', fakeDb() as never, { slack_channel_id: channel }, {}, OPERATOR_PROJECT)
    return { result, fetchMock }
  }

  it('is down when the channel is not found, with a detail the setup gap recognises', async () => {
    const { result, fetchMock } = await probe({ ok: false, error: 'channel_not_found' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toContain('conversations.info?channel=C0B82A322RW')
    expect(result.status).toBe('down')
    expect(result.detail).toContain('channel_not_found')
  })

  it('is down when the channel is archived', async () => {
    const { result } = await probe({ ok: true, channel: { is_archived: true } })
    expect(result.status).toBe('down')
    expect(result.detail).toContain('is_archived')
  })

  it('stays ok when the channel is fine, or the bot may not ask (missing_scope)', async () => {
    expect((await probe({ ok: true, channel: { is_archived: false } })).result.status).toBe('ok')
    expect((await probe({ ok: false, error: 'missing_scope' })).result.status).toBe('ok')
  })

  it('does not call conversations.info when no channel is stored', async () => {
    const { result, fetchMock } = await probe({ ok: false, error: 'channel_not_found' }, null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('ok')
  })

  it('tells the owner how to add the app to a private channel, and keeps the code setup gaps match on', async () => {
    const { slackChannelAdvice } = await import('../../supabase/functions/_shared/integration-probes.ts')
    const { slackGap } = await import('../../supabase/functions/_shared/setup-gaps.ts')
    const notFound = slackChannelAdvice('C0B82A322RW', 'channel_not_found')
    expect(notFound).toContain('(channel_not_found)')
    expect(notFound).toMatch(/private channel, add the app: in Slack open the channel/)
    expect(notFound).toContain('Send test')
    expect(slackChannelAdvice('C1', 'is_archived')).toMatch(/is archived \(is_archived\)\. Pick another channel/)
    const now = new Date('2026-10-31T03:00:00Z')
    const gap = slackGap(
      { projectId: 'p1', connected: true, latest: { status: 'down', message: notFound, checked_at: now.toISOString() } },
      now,
    )
    expect(gap.status).toBe('gap')
  })
})
