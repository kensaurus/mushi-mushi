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

type HealthRow = { status: string; message: string | null; checked_at: string }

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
