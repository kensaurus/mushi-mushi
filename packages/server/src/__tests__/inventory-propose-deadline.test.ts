/**
 * FILE: packages/server/src/__tests__/inventory-propose-deadline.test.ts
 * PURPOSE: Drive proposeAndPersist against a fake database and assert the row
 *          it writes, plus that the model call carries a deadline.
 *
 * Why (2026-09-22): the hourly drift_watch cron had no deadline, so the run
 * outlived the edge runtime and was killed before the insert. Once it could
 * return, it said what had been failing all along: `created_by` is a uuid and
 * the cron passed 'cron:drift-watch', and `source` is a typed column
 * (passive_discovery | live_crawl | manual) that rejected the label too. Five
 * consecutive 150 s `degraded` cron rows — not a test — caught the original
 * bug, so this pins the payload itself rather than the source text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shaped like `discovery_observed_inventory` rows: buildUserPrompt reads the
// array columns directly.
const OBSERVATIONS = Array.from({ length: 6 }, (_, i) => ({
  route: `/page-${i}`,
  observation_count: 10 - i,
  project_id: 'p1',
  latest_title: `Page ${i}`,
  latest_dom_summary: null,
  observed_testids: [`btn-${i}`],
  observed_apis: [`/api/page-${i}`],
  distinct_users: 3,
}))

const INVENTORY = {
  schema_version: '2.0',
  app: { id: 'app', name: 'App', base_url: 'https://example.com' },
  user_stories: [],
  pages: [{ slug: 'page-0', path: '/page-0', elements: [] }],
}

const { generateTextCalls, inserted, attemptMs } = vi.hoisted(() => ({
  generateTextCalls: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  /** null = use the real budget maths; a number forces that attempt length. */
  attemptMs: { value: null as number | null },
}))

// Keep the real budget logic, but allow one test to shorten an attempt so the
// signal's deadline can be observed rather than assumed.
vi.mock('../../supabase/functions/inventory-propose/run-budget.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabase/functions/inventory-propose/run-budget.ts')>()
  return {
    ...actual,
    nextAttemptTimeoutMs: (remaining: number, reserve?: number) =>
      attemptMs.value ?? actual.nextAttemptTimeoutMs(remaining, reserve),
  }
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/safe-error.ts', () => ({ safeErrorResponse: () => new Response() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/validate.ts', () => ({
  parseBody: async () => ({ ok: true, data: {} }),
  InventoryProposeBodySchema: {},
}))
vi.mock('../../supabase/functions/_shared/prompt-ab.ts', () => ({
  getPromptForStage: async () => ({ promptTemplate: null }),
}))
vi.mock('../../supabase/functions/_shared/inventory.ts', () => ({
  validateInventoryObject: (o: unknown) => ({ ok: true, inventory: o, issues: [] }),
}))
// `npm:` specifiers are rewritten to this shared stub by vitest.config.ts
// before a per-specifier vi.mock could apply, so intercept the stub itself:
// that is the module `generateText` and `createAnthropic` really come from.
vi.mock('./__stubs__/npm-stub.ts', () => ({
  default: {},
  z: {},
  createClient: () => ({}),
  generateObject: async () => ({}),
  createAnthropic: () => (id: string) => ({ id }),
  generateText: async (args: Record<string, unknown>) => {
    generateTextCalls.push(args)
    return {
      text: '```json\n' + JSON.stringify({ inventory: INVENTORY, rationale_by_story: { s1: 'because' } }) + '\n```',
      usage: { promptTokens: 10, completionTokens: 20 },
    }
  },
  reportError: () => {},
  reportMessage: () => {},
  init: () => {},
  captureException: () => {},
  captureMessage: () => {},
}))
vi.mock('../../supabase/functions/_shared/llm-failover.ts', () => ({
  // Run the proposer with a fake resolved key, like the real helper does.
  withLlmFailover: async (_db: unknown, _p: string, _v: string, run: (r: { key: string }) => Promise<unknown>) =>
    run({ key: 'test-key' }),
  WalletDeniedError: class WalletDeniedError extends Error {},
}))

/**
 * @param currentInventories rows for `inventories` — one per drift-watch
 *                           candidate project (empty for the single-project
 *                           tests, which never read it).
 */
function fakeDb(currentInventories: Array<Record<string, unknown>> = []) {
  const table = (name: string) => {
    const rowFor = () => {
      if (name === 'discovery_observed_inventory') return { data: OBSERVATIONS, error: null }
      // Drift watch lists every project holding a current inventory; the
      // single-project path reads one row and only needs `parsed`.
      if (name === 'inventories') {
        return currentInventories.length
          ? { data: currentInventories, error: null }
          : { data: { parsed: null }, error: null }
      }
      if (name === 'projects') return { data: { slug: 'app', name: 'App' }, error: null }
      // No open draft → nothing is in cooldown.
      if (name === 'inventory_proposals') return { data: null, error: null }
      return { data: null, error: null }
    }
    // Chainable stub: every builder method returns itself and it is awaitable.
    const builder: Record<string, unknown> = {
      maybeSingle: async () => rowFor(),
      single: async () => ({ data: { id: 'proposal-1' }, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve(rowFor()).then(res),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 'proposal-1' }, error: null }) }) }
      },
    }
    for (const m of ['select', 'eq', 'gte', 'order', 'limit']) builder[m] = () => builder
    return builder
  }
  return { from: (name: string) => table(name) }
}

let proposeAndPersist: typeof import('../../supabase/functions/inventory-propose/index.ts').proposeAndPersist
let handleDriftWatch: typeof import('../../supabase/functions/inventory-propose/index.ts').handleDriftWatch

beforeEach(async () => {
  generateTextCalls.length = 0
  inserted.length = 0
  vi.resetModules()
  // The module ends in `Deno.serve(...)` behind a typeof guard; give it a
  // no-op so importing it does not start a server.
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: () => {} })
  ;({ proposeAndPersist, handleDriftWatch } = await import('../../supabase/functions/inventory-propose/index.ts'))
})
afterEach(() => vi.unstubAllGlobals())

// The fake db records the row; it does not model the uuid type or the CHECK,
// so these pin the values Postgres rejected, not Postgres itself.
describe('proposeAndPersist writes the values the schema allows', () => {
  it('puts a cron label in metadata, not in the uuid column', async () => {
    const res = await proposeAndPersist(fakeDb() as never, 'p1', 'cron:drift-watch')
    expect(res.proposalId).toBe('proposal-1')
    expect(inserted).toHaveLength(1)
    const row = inserted[0]
    // created_by is uuid: a label here is what Postgres rejected.
    expect(row.created_by).toBeNull()
    // source has a CHECK: passive_discovery | live_crawl | manual.
    expect(row.source).toBe('passive_discovery')
    expect((row.rationale_by_story as Record<string, unknown>).__triggered_by).toBe('cron:drift-watch')
  })

  it('keeps a real user id in created_by', async () => {
    const userId = 'eb0c15cc-4139-490b-a335-35b3d87428df'
    await proposeAndPersist(fakeDb() as never, 'p1', userId)
    expect(inserted[0].created_by).toBe(userId)
    expect(inserted[0].source).toBe('passive_discovery')
  })

  it('gives every model call a deadline', async () => {
    await proposeAndPersist(fakeDb() as never, 'p1', null)
    expect(generateTextCalls).toHaveLength(1)
    const signal = generateTextCalls[0].abortSignal as AbortSignal | undefined
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('takes the deadline from the run budget, not a fixed constant', async () => {
    // Force a 1 ms attempt. A hardcoded AbortSignal.timeout(…) would leave the
    // signal unaborted here, so this fails if the budget stops feeding it.
    attemptMs.value = 1
    try {
      await proposeAndPersist(fakeDb() as never, 'p1', null)
      const signal = generateTextCalls[0].abortSignal as AbortSignal
      await new Promise((r) => setTimeout(r, 20))
      expect(signal.aborted).toBe(true)
    } finally {
      attemptMs.value = null
    }
  })

  it('stops instead of calling the model when the budget is spent', async () => {
    // Deadline already in the past: no attempt may start, and the draft is
    // still persisted so the work is not lost.
    await proposeAndPersist(fakeDb() as never, 'p1', null, undefined, Date.now() - 1_000)
    expect(generateTextCalls).toHaveLength(0)
    expect(inserted).toHaveLength(1)
    // "No attempt was made" has to be distinguishable from "every attempt
    // failed": without the budget check the loop still runs and records a
    // failure, which is a different draft.
    const row = inserted[0]
    expect((row.rationale_by_story as Record<string, unknown>).__validation_errors).toBe('unknown')
    expect(row.proposed_yaml as string).toContain('failed validation 0 time(s)')
  })
})

describe('drift watch fires at most its share per run', () => {
  // Two projects, both drifted past the threshold, default cap of one per run.
  const TWO_DRIFTED = [
    { project_id: 'p1', parsed: { schema_version: '2.0', app: {}, user_stories: [], pages: [] } },
    { project_id: 'p2', parsed: { schema_version: '2.0', app: {}, user_stories: [], pages: [] } },
  ]

  it('proposes for one project and defers the rest', async () => {
    const res = await handleDriftWatch(fakeDb(TWO_DRIFTED) as never, {} as never)
    const body = (await res.json()) as { data: { fired: number; deferred: number; results: Array<Record<string, unknown>> } }

    // Without the cap both projects fire, which is the unbounded hourly spend
    // the budget work exists to stop.
    expect(body.data.fired).toBe(1)
    expect(body.data.deferred).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(generateTextCalls).toHaveLength(1)
    expect(body.data.results.map((r) => r.skipped)).toContain('deferred_to_next_run')
  })
})
