/**
 * FILE: qa-story-runner-schedule.test.ts
 * PURPOSE: Drive the scheduled qa-story-runner tick and assert which
 *          qa_story_runs rows it inserts.
 *
 * A failed latest-run read, a skipped run in the current slot, and a chatty
 * neighbour must not start another cloud run. Local stories and stories past
 * the per-project cap get no row at all.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const NOW = '2026-10-24T12:00:30.000Z'

let db: FakeDb
let served: ((req: Request) => Promise<Response>) | null = null

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (...args: unknown[]) => args[args.length - 1],
  reportError: () => {},
  reportMessage: () => {},
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: async () => ({ key: 'fc-test', source: 'project' }),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: () => Promise.resolve(),
}))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))

function qaStory(partial: Row & { id: string }): Row {
  return {
    project_id: 'p1',
    name: partial.id,
    prompt: null,
    script: null,
    script_lang: 'playwright-ts',
    browser_provider: 'firecrawl_actions',
    schedule_cron: '0 * * * *',
    enabled: true,
    capture_video: false,
    byok_provider: null,
    target_url: 'https://example.com/',
    last_run_status: null,
    consecutive_failures: 0,
    slack_failure_ts: null,
    last_notified_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function runsFor(storyId: string): Row[] {
  return (db.tables.qa_story_runs ?? []).filter((r) => r.story_id === storyId)
}

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: () => undefined },
    serve: (handler: (req: Request) => Promise<Response>) => { served = handler },
  }
  await import('../../supabase/functions/qa-story-runner/index.ts')
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ success: true, data: { markdown: 'ok' } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  db = makeFakeDb({}, { autoId: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

afterAll(() => {
  delete (globalThis as { Deno?: unknown }).Deno
})

async function tick(): Promise<void> {
  expect(served).toBeTypeOf('function')
  const res = await served!(new Request('https://edge.local/qa-story-runner', { method: 'POST' }))
  expect(res.status).toBe(200)
}

describe('qa-story-runner scheduled tick', () => {
  it('does not start a story when its latest-run read fails', async () => {
    db = makeFakeDb(
      { qa_stories: [qaStory({ id: 's1' })] },
      { autoId: true, failRead: (table) => (table === 'qa_story_runs' ? 'connection reset' : null) },
    )
    await tick()
    expect(db.tables.qa_story_runs ?? []).toHaveLength(0)
  })

  it('starts the story whose read worked when another read failed', async () => {
    db = makeFakeDb({
      qa_stories: [qaStory({ id: 'good' }), qaStory({ id: 'bad' })],
      qa_story_runs: [
        { id: 'g1', story_id: 'good', project_id: 'p1', status: 'passed', started_at: '2026-10-24T11:00:00.000Z' },
      ],
    }, { autoId: true })
    const orig = db.from.bind(db)
    db.from = (name: string) => {
      const q = orig(name)
      if (name !== 'qa_story_runs') return q
      let storyId: string | null = null
      const origEq = q.eq.bind(q)
      q.eq = (key: string, value: unknown) => {
        if (key === 'story_id') storyId = String(value)
        return origEq(key, value)
      }
      const origThen = q.then.bind(q)
      q.then = ((onFulfilled, onRejected) => {
        if (storyId === 'bad') {
          return Promise.resolve({ data: null, error: { message: 'connection reset' }, count: null }).then(onFulfilled, onRejected)
        }
        return origThen(onFulfilled, onRejected)
      }) as typeof q.then
      return q
    }
    await tick()
    expect(runsFor('bad')).toHaveLength(0)
    expect(runsFor('good')).toHaveLength(2)
  })

  it('counts a skipped run in the current slot as already handled', async () => {
    db = makeFakeDb({
      qa_stories: [qaStory({ id: 'in-slot', browser_provider: 'browserbase' }), qaStory({ id: 'prev-slot' })],
      qa_story_runs: [
        { id: 'r1', story_id: 'in-slot', project_id: 'p1', status: 'skipped', started_at: '2026-10-24T12:00:10.000Z' },
        { id: 'r2', story_id: 'prev-slot', project_id: 'p1', status: 'skipped', started_at: '2026-10-24T11:30:00.000Z' },
      ],
    }, { autoId: true })
    await tick()
    expect(runsFor('in-slot')).toHaveLength(1)
    expect(runsFor('prev-slot')).toHaveLength(2)
  })

  it('keeps a story idle when a chatty neighbour would fill a shared page', async () => {
    const noisy = Array.from({ length: 1000 }, (_, i) => ({
      id: `n-${i}`,
      story_id: 'noisy',
      project_id: 'p1',
      status: 'passed',
      started_at: '2026-10-24T12:00:20.000Z',
    }))
    db = makeFakeDb({
      qa_stories: [qaStory({ id: 'quiet' }), qaStory({ id: 'noisy' })],
      qa_story_runs: [
        ...noisy,
        { id: 'quiet-run', story_id: 'quiet', project_id: 'p1', status: 'passed', started_at: '2026-10-24T12:00:01.000Z' },
      ],
    }, { autoId: true })
    await tick()
    expect(runsFor('quiet')).toHaveLength(1)
    expect(runsFor('noisy')).toHaveLength(1000)
  })

  it('inserts no row for a local story or a story past the cap', async () => {
    db = makeFakeDb({
      qa_stories: [
        qaStory({ id: 'local', browser_provider: 'local' }),
        qaStory({ id: 'a' }),
        qaStory({ id: 'b' }),
        qaStory({ id: 'c' }),
        qaStory({ id: 'd' }),
      ],
    }, { autoId: true })
    await tick()
    expect(runsFor('local')).toHaveLength(0)
    expect(runsFor('d')).toHaveLength(0)
    expect(runsFor('a')).toHaveLength(1)
    expect(runsFor('b')).toHaveLength(1)
    expect(runsFor('c')).toHaveLength(1)
    expect(db.tables.qa_story_runs.every((r) => r.status !== 'skipped')).toBe(true)
  })

  it('does not start a story created after the current slot', async () => {
    db = makeFakeDb({
      qa_stories: [
        qaStory({ id: 'brand-new', created_at: '2026-10-24T12:30:00.000Z' }),
        qaStory({ id: 'old-due' }),
      ],
    }, { autoId: true })
    await tick()
    expect(runsFor('brand-new')).toHaveLength(0)
    expect(runsFor('old-due')).toHaveLength(1)
  })
})
