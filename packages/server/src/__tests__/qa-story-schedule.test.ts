/**
 * FILE: packages/server/src/__tests__/qa-story-schedule.test.ts
 * PURPOSE: A scheduled qa-story tick runs approved stories only.
 *          pending_review must not be picked — those runs spend
 *          Firecrawl/Browserbase credits and notify on failure.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_STORY_CRON,
  selectStoriesForScheduledTick,
} from '../../supabase/functions/qa-story-runner/schedule.ts'

/**
 * Chainable stand-in for the Supabase query builder. Filter calls are recorded
 * so a test can see `.eq('approval_status', 'approved')` on the real runner
 * query, not on a copy of its source.
 */
const { eqCalls, resetEqCalls, MANUAL_STORY, query } = vi.hoisted(() => {
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = []
  const MANUAL_STORY = {
    id: '11111111-1111-4111-8111-111111111111',
    project_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Pending but asked for by hand',
    prompt: null,
    script: null,
    script_lang: 'playwright-js',
    browser_provider: 'local',
    schedule_cron: '* * * * *',
    enabled: true,
    capture_video: false,
    byok_provider: null,
    target_url: 'https://example.com',
    approval_status: 'pending_review',
    last_run_status: null,
    consecutive_failures: 0,
    slack_failure_ts: null,
    last_notified_at: null,
  }
  function query(table: string) {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const method of ['select', 'insert', 'update', 'order', 'limit']) builder[method] = chain
    builder.eq = (column: string, value: unknown) => {
      eqCalls.push({ table, column, value })
      return builder
    }
    builder.single = () =>
      Promise.resolve({
        data: table === 'qa_stories' ? MANUAL_STORY : { id: 'cron-1' },
        error: null,
      })
    builder.maybeSingle = () =>
      Promise.resolve({
        data: table === 'qa_stories' ? { consecutive_failures: 0 } : null,
        error: null,
      })
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)
    return builder
  }
  return {
    eqCalls,
    resetEqCalls: () => {
      eqCalls.length = 0
    },
    MANUAL_STORY,
    query,
  }
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info() {}, warn() {}, error() {}, debug() {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({ from: (table: string) => query(table) }),
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  requireServiceRoleAuth: () => null,
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, handler: (req: Request) => Promise<Response>) => handler,
  reportError: vi.fn(),
  reportMessage: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({
  startCronRun: async () => ({ finish: async () => {}, fail: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: async () => null,
}))
vi.mock('../../supabase/functions/_shared/slack.ts', () => ({
  sendBotMessage: async () => ({ ok: true }),
  sendSlackText: async () => {},
  buildQaStoryRunBlocks: () => [],
  sendDiscordNotification: async () => {},
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: () => Promise.resolve(),
}))
vi.mock('../../supabase/functions/_shared/inventory-guards.ts', () => ({
  safeFetch: async () => {
    throw new Error('scheduled test must not fetch')
  },
}))

const now = new Date('2026-10-24T00:00:00Z')
const due = () => true

function story(id: string, approval_status: string) {
  return { id, enabled: true, approval_status, schedule_cron: '* * * * *' }
}

describe('selectStoriesForScheduledTick', () => {
  it('picks an approved story and leaves a pending_review story', () => {
    const picked = selectStoriesForScheduledTick(
      [story('pending', 'pending_review'), story('ok', 'approved')],
      now,
      due,
    )
    expect(picked.map((s) => s.id)).toEqual(['ok'])
  })

  it('leaves a rejected story even when its cron is due', () => {
    expect(selectStoriesForScheduledTick([story('no', 'rejected')], now, due)).toEqual([])
  })

  it('leaves an approved story whose cron is not due', () => {
    expect(selectStoriesForScheduledTick([story('ok', 'approved')], now, () => false)).toEqual([])
  })

  it('keeps the previous default cron when a story has none', () => {
    const seen: string[] = []
    selectStoriesForScheduledTick(
      [{ id: 'bare', approval_status: 'approved', schedule_cron: null }],
      now,
      (expression) => {
        seen.push(expression)
        return true
      },
    )
    expect(seen).toEqual([DEFAULT_STORY_CRON])
    expect(DEFAULT_STORY_CRON).toBe('*/15 * * * *')
  })

  it('treats a missing approval_status as not approved', () => {
    const picked = selectStoriesForScheduledTick(
      [{ id: 'legacy', enabled: true, schedule_cron: '* * * * *' }],
      now,
      due,
    )
    expect(picked).toEqual([])
  })
})

describe('qa-story-runner query', () => {
  let handler: ((req: Request) => Promise<Response>) | undefined

  beforeAll(async () => {
    vi.stubGlobal('Deno', {
      serve: (fn: (req: Request) => Promise<Response>) => {
        handler = fn
      },
      env: { get: () => undefined },
    })
    await import('../../supabase/functions/qa-story-runner/index.ts')
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => resetEqCalls())

  function storyFilters() {
    return eqCalls
      .filter((call) => call.table === 'qa_stories')
      .map((call) => [call.column, call.value])
  }

  async function run(req: Request) {
    if (!handler) throw new Error('qa-story-runner did not register a handler')
    return handler(req)
  }

  it('asks the database for enabled stories whose approval_status is approved', async () => {
    const res = await run(new Request('https://mushi.test/qa-story-runner', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(storyFilters()).toContainEqual(['enabled', true])
    expect(storyFilters()).toContainEqual(['approval_status', 'approved'])
  })

  it('runs a manual story even when it is still pending_review', async () => {
    const res = await run(
      new Request('https://mushi.test/qa-story-runner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trigger: 'manual',
          story_id: MANUAL_STORY.id,
          run_id: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'skipped' })
    expect(storyFilters().map(([column]) => column)).not.toContain('approval_status')
    expect(storyFilters()).toContainEqual(['id', MANUAL_STORY.id])
  })
})
