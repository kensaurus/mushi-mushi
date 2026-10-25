/**
 * FILE: qa-story-runner-schedule.test.ts
 * PURPOSE: Drive the scheduled qa-story-runner tick and assert which
 *          qa_story_runs rows it inserts.
 *
 * A failed latest-run read, a skipped run in the current slot, and a chatty
 * neighbour must not start another cloud run. Local stories and stories past
 * the per-project cap get no row at all. Latest starts are one RPC. Running
 * rows for every story this tick starts are inserted before any of them
 * execute, so a second tick overlapping a long run does not start them again.
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

const LATEST_RUNS_RPC = 'qa_story_latest_started_at'
const armedLatestRuns = new WeakSet<FakeDb>()

/** Stand-in for qa_story_latest_started_at: one latest start per story. */
function latestStartedAt(database: FakeDb, args: Record<string, unknown>): Array<{ story_id: string; started_at: string }> {
  const ids = new Set((args.p_story_ids as string[] | undefined) ?? [])
  const since = String(args.p_since ?? '')
  const best = new Map<string, string>()
  for (const row of database.tables.qa_story_runs ?? []) {
    const id = String(row.story_id ?? '')
    if (!ids.has(id)) continue
    const at = row.started_at
    if (typeof at !== 'string' || at < since) continue
    const prev = best.get(id)
    if (!prev || at > prev) best.set(id, at)
  }
  return [...best].map(([story_id, started_at]) => ({ story_id, started_at }))
}

function armLatestRuns(database: FakeDb): void {
  if (armedLatestRuns.has(database)) return
  armedLatestRuns.add(database)
  const prior = database.options.rpc
  database.options.rpc = (fn, args) => {
    if (fn === LATEST_RUNS_RPC) return latestStartedAt(database, args)
    return prior ? prior(fn, args) : null
  }
}

function countStoryIdFilters(database: FakeDb): { count: () => number } {
  let n = 0
  const orig = database.from.bind(database)
  database.from = (name: string) => {
    const q = orig(name)
    if (name !== 'qa_story_runs') return q
    const origEq = q.eq.bind(q)
    q.eq = (key: string, value: unknown) => {
      if (key === 'story_id') n += 1
      return origEq(key, value)
    }
    return q
  }
  return { count: () => n }
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

async function tick(): Promise<Response> {
  armLatestRuns(db)
  expect(served).toBeTypeOf('function')
  const res = await served!(new Request('https://edge.local/qa-story-runner', { method: 'POST' }))
  expect(res.status).toBe(200)
  return res
}

async function waitUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (pred()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for the scheduled tick')
}

describe('qa-story-runner scheduled tick', () => {
  it('does not start a story when its latest-run read fails', async () => {
    db = makeFakeDb(
      { qa_stories: [qaStory({ id: 's1' })] },
      { autoId: true, rpcError: () => ({ code: 'XX000', message: 'connection reset' }) },
    )
    await tick()
    expect(db.tables.qa_story_runs ?? []).toHaveLength(0)
  })

  it('reads every story\'s latest start in one call', async () => {
    const stories = Array.from({ length: 25 }, (_, i) => qaStory({ id: `s${String(i).padStart(2, '0')}` }))
    db = makeFakeDb({ qa_stories: stories }, { autoId: true })
    const filters = countStoryIdFilters(db)
    await tick()
    const calls = db.rpcCalls.filter((c) => c.fn === LATEST_RUNS_RPC)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args.p_story_ids).toHaveLength(25)
    expect(calls[0]?.args.p_since).toBe('2026-10-24T11:00:30.000Z')
    expect(filters.count()).toBe(0)
    expect(db.tables.qa_story_runs).toHaveLength(3)
  })

  it('still starts a due story when the latest-run function is not installed yet', async () => {
    db = makeFakeDb({ qa_stories: [qaStory({ id: 's1' })] }, {
      autoId: true,
      rpcError: (fn) => fn === LATEST_RUNS_RPC
        ? { code: 'PGRST202', message: 'Could not find the function public.qa_story_latest_started_at' }
        : null,
    })
    const filters = countStoryIdFilters(db)
    await tick()
    expect(db.rpcCalls.map((c) => c.fn)).toContain(LATEST_RUNS_RPC)
    expect(filters.count()).toBe(1)
    expect(runsFor('s1')).toHaveLength(1)
  })

  it('claims every story before executing, so an overlapping tick does not start them again', async () => {
    db = makeFakeDb({
      qa_stories: [qaStory({ id: 'a' }), qaStory({ id: 'b' }), qaStory({ id: 'c' })],
    }, { autoId: true })
    armLatestRuns(db)
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let fetches = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetches += 1
      await gate
      return new Response(
        JSON.stringify({ success: true, data: { markdown: 'ok' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }))
    const first = served!(new Request('https://edge.local/qa-story-runner', { method: 'POST' }))
    try {
      await waitUntil(() => fetches >= 1)
      expect(runsFor('a')).toHaveLength(1)
      expect(runsFor('b')).toHaveLength(1)
      expect(runsFor('c')).toHaveLength(1)
      expect(fetches).toBe(1)

      const second = served!(new Request('https://edge.local/qa-story-runner', { method: 'POST' }))
      const secondResult = await Promise.race([
        second.then((res) => ({ kind: 'done' as const, res })),
        new Promise<{ kind: 'hung' }>((resolve) => setTimeout(() => resolve({ kind: 'hung' }), 1000)),
      ])
      expect(secondResult.kind).toBe('done')
      if (secondResult.kind !== 'done') return
      expect(secondResult.res.status).toBe(200)
      expect(await secondResult.res.json()).toMatchObject({ due: 0 })
      expect(fetches).toBe(1)
      expect(runsFor('a')).toHaveLength(1)
      expect(runsFor('b')).toHaveLength(1)
      expect(runsFor('c')).toHaveLength(1)
    } finally {
      release()
      const firstRes = await first
      expect(firstRes.status).toBe(200)
    }
    expect(runsFor('a')).toHaveLength(1)
    expect(runsFor('b')).toHaveLength(1)
    expect(runsFor('c')).toHaveLength(1)
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
