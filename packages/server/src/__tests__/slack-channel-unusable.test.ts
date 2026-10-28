/**
 * FILE: slack-channel-unusable.test.ts
 * PURPOSE: A stale Slack channel (deleted, archived, or the bot was never
 *          invited) makes chat.postMessage return channel_not_found or
 *          not_in_channel. That used to be logged as an error, so every
 *          notification paged Sentry and the channel still looked healthy.
 *          The send path records the channel down and does not call Slack
 *          again until the cooldown passes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportMessage: vi.fn(),
}))

type HealthDetail = { slack_error?: string | null; channel_id?: string | null }

type HealthRow = {
  status: string
  message: string | null
  checked_at: string
  source?: string
  detail?: HealthDetail | null
}

function memoryDb() {
  let latest: HealthRow | null = null
  const inserts: HealthRow[] = []
  const chain = {
    select() {
      return chain
    },
    eq() {
      return chain
    },
    order() {
      return chain
    },
    limit() {
      return chain
    },
    maybeSingle: async () => ({ data: latest }),
    insert: async (row: HealthRow) => {
      latest = { ...row, checked_at: row.checked_at ?? new Date().toISOString() }
      inserts.push(latest)
      return { error: null }
    },
  }
  return {
    db: {
      from(table: string) {
        if (table !== 'integration_health_history') throw new Error(`unexpected table ${table}`)
        return chain
      },
    },
    inserts,
    setLatest(row: HealthRow | null) {
      latest = row
    },
  }
}

async function load() {
  vi.resetModules()
  vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } })
  return import('../../supabase/functions/_shared/slack.ts')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.MUSHI_OPERATOR_USER_IDS
  delete process.env.SLACK_BOT_TOKEN
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Slack health probe notices a channel the bot cannot post to', () => {
  const OPERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const PROJECT = '11111111-1111-4111-8111-111111111111'

  it('marks the integration down when auth.test passes but the channel is gone', async () => {
    process.env.MUSHI_OPERATOR_USER_IDS = OPERATOR
    process.env.SLACK_BOT_TOKEN = 'xoxb-operator'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('conversations.info')) {
        return new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, team: 'acme', bot_id: 'B1' }), { status: 200 })
    }))
    vi.resetModules()
    vi.stubGlobal('Deno', {
      env: { get: (key: string) => process.env[key] },
    })
    const { probeIntegration } = await import('../../supabase/functions/_shared/integration-probes.ts')
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => table === 'projects'
              ? { data: { owner_id: OPERATOR }, error: null }
              : { data: null, error: null },
          }),
        }),
      }),
    }
    const result = await probeIntegration('slack', db as never, { slack_channel_id: 'C0DEAD' }, {}, PROJECT)
    expect(result.status).toBe('down')
    expect(result.detail).toMatch(/C0DEAD/)
    expect(result.detail).toMatch(/pick the channel again/i)
    expect(result.historyDetail).toEqual({ slack_error: 'channel_not_found', channel_id: 'C0DEAD' })
  })

  it('marks a private channel the bot has not joined as down', async () => {
    process.env.MUSHI_OPERATOR_USER_IDS = OPERATOR
    process.env.SLACK_BOT_TOKEN = 'xoxb-operator'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('conversations.info')) {
        return new Response(JSON.stringify({
          ok: true,
          channel: { is_archived: false, is_private: true, is_member: false },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, team: 'acme', bot_id: 'B1' }), { status: 200 })
    }))
    vi.resetModules()
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } })
    const { probeIntegration } = await import('../../supabase/functions/_shared/integration-probes.ts')
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => table === 'projects'
              ? { data: { owner_id: OPERATOR }, error: null }
              : { data: null, error: null },
          }),
        }),
      }),
    }
    const result = await probeIntegration('slack', db as never, { slack_channel_id: 'C0PRIVATE' }, {}, PROJECT)
    expect(result.status).toBe('down')
    expect(result.detail).toMatch(/\/invite/)
    expect(result.historyDetail).toEqual({ slack_error: 'not_in_channel', channel_id: 'C0PRIVATE' })
  })

  it('leaves a public channel the bot has not joined as ok', async () => {
    // chat:write.public posts to public channels without /invite. conversations.info
    // still reports is_member false, and treating that as not_in_channel would
    // mark a working channel down.
    process.env.MUSHI_OPERATOR_USER_IDS = OPERATOR
    process.env.SLACK_BOT_TOKEN = 'xoxb-operator'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('conversations.info')) {
        return new Response(JSON.stringify({
          ok: true,
          channel: { is_archived: false, is_private: false, is_member: false },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, team: 'acme', bot_id: 'B1' }), { status: 200 })
    }))
    vi.resetModules()
    vi.stubGlobal('Deno', { env: { get: (key: string) => process.env[key] } })
    const { probeIntegration } = await import('../../supabase/functions/_shared/integration-probes.ts')
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => table === 'projects'
              ? { data: { owner_id: OPERATOR }, error: null }
              : { data: null, error: null },
          }),
        }),
      }),
    }
    const result = await probeIntegration('slack', db as never, { slack_channel_id: 'C0PUBLIC' }, {}, PROJECT)
    expect(result.status).toBe('ok')
    expect(result.historyDetail).toBeUndefined()
  })
})

describe('sendBotMessage when the channel cannot take a post', () => {
  it('records channel_not_found as down and does not page Sentry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    const { sendBotMessage } = await load()
    const { reportMessage } = await import('../../supabase/functions/_shared/sentry.ts')

    const result = await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0DEAD',
      text: 'bug alert',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(result).toMatchObject({ ok: false, ts: null, error: 'channel_not_found' })
    expect(reportMessage).not.toHaveBeenCalled()
    expect(store.inserts).toHaveLength(1)
    expect(store.inserts[0]).toMatchObject({
      project_id: 'proj-1',
      kind: 'slack',
      status: 'down',
    })
    expect(store.inserts[0].message).toMatch(/C0DEAD/)
    expect(store.inserts[0].message).toMatch(/pick the channel again/i)
    expect(store.inserts[0].source).toBe('send')
    expect(store.inserts[0].detail).toEqual({ slack_error: 'channel_not_found', channel_id: 'C0DEAD' })
  })

  it('tells the user to invite the bot on not_in_channel, and still does not page Sentry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }), { status: 200 })))
    const store = memoryDb()
    const { sendBotMessage } = await load()
    const { reportMessage } = await import('../../supabase/functions/_shared/sentry.ts')

    const result = await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0PRIVATE',
      text: 'bug alert',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(result.error).toBe('not_in_channel')
    expect(reportMessage).not.toHaveBeenCalled()
    expect(store.inserts[0].message).toMatch(/\/invite/)
    expect(store.inserts[0].message).toMatch(/C0PRIVATE/)
  })

  it('does not call Slack again while that channel is still marked down', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    const { sendBotMessage } = await load()

    const opts = {
      token: 'xoxb-test',
      channel: 'C0DEAD',
      text: 'bug alert',
      db: store.db,
      projectId: 'proj-1',
    }
    await sendBotMessage(opts)
    await sendBotMessage(opts)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.inserts).toHaveLength(1)
  })

  it('tries again after the cooldown, and tries a different channel immediately', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'is_archived' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    store.setLatest({
      status: 'down',
      message: 'Slack channel C0OLD is archived. Pick another channel on Integrations.',
      checked_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    })
    const { sendBotMessage } = await load()

    await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0OLD',
      text: 'again',
      db: store.db,
      projectId: 'proj-1',
    })
    await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0NEW',
      text: 'other',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cools down from the stored slack error and channel, not from the health sentence', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    store.setLatest({
      status: 'down',
      message: 'The channel copy was rewritten and no longer mentions the old phrases.',
      checked_at: new Date().toISOString(),
      detail: { slack_error: 'channel_not_found', channel_id: 'C0DEAD' },
    })
    const { sendBotMessage } = await load()

    const skipped = await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0DEAD',
      text: 'again',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(skipped).toMatchObject({ ok: false, error: 'channel_not_found' })
    expect(fetchMock).not.toHaveBeenCalled()
    const warns = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]))
    expect(warns.some((line) => line.includes('chat.postMessage skipped') && line.includes('C0DEAD'))).toBe(true)
  })

  it('does not cool down from a health sentence when the row has no structured channel error', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    store.setLatest({
      status: 'down',
      message: 'Slack channel C0DEAD was not found. It may have been deleted or belong to another workspace. Pick the channel again on Integrations.',
      checked_at: new Date().toISOString(),
      detail: null,
    })
    const { sendBotMessage } = await load()

    await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0DEAD',
      text: 'again',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('posts again after a successful test replaced the down row', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    store.setLatest({
      status: 'ok',
      message: 'Test message delivered',
      checked_at: new Date().toISOString(),
      source: 'manual',
      detail: null,
    })
    const { sendBotMessage } = await load()

    const result = await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0DEAD',
      text: 'again',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('posts again after the channel setting was saved', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = memoryDb()
    store.setLatest({
      status: 'unknown',
      message: 'Slack channel C0DEAD saved. The next notification will try this channel.',
      checked_at: new Date().toISOString(),
      source: 'manual',
      detail: { channel_id: 'C0DEAD' },
    })
    const { sendBotMessage } = await load()

    await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0DEAD',
      text: 'again',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still pages Sentry for an unexpected Slack error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), { status: 200 })))
    const store = memoryDb()
    const { sendBotMessage } = await load()
    const { reportMessage } = await import('../../supabase/functions/_shared/sentry.ts')

    const result = await sendBotMessage({
      token: 'xoxb-test',
      channel: 'C0OK',
      text: 'bug alert',
      db: store.db,
      projectId: 'proj-1',
    })

    expect(result.error).toBe('ratelimited')
    expect(reportMessage).toHaveBeenCalled()
    expect(store.inserts).toHaveLength(0)
  })
})
