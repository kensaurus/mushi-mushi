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

const { generateTextCalls, inserted } = vi.hoisted(() => ({
  generateTextCalls: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
}))

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

function fakeDb() {
  const table = (name: string) => {
    if (name === 'inventory_proposals') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row)
          return { select: () => ({ single: async () => ({ data: { id: 'proposal-1' }, error: null }) }) }
        },
      }
    }
    const rowFor = () => {
      if (name === 'discovery_observed_inventory') return { data: OBSERVATIONS, error: null }
      if (name === 'inventories') return { data: { parsed: null }, error: null }
      if (name === 'projects') return { data: { slug: 'app', name: 'App' }, error: null }
      return { data: null, error: null }
    }
    // Chainable stub: every builder method returns itself and it is awaitable.
    const builder: Record<string, unknown> = {
      maybeSingle: async () => rowFor(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(rowFor()).then(res),
    }
    for (const m of ['select', 'eq', 'gte', 'order', 'limit']) builder[m] = () => builder
    return builder
  }
  return { from: (name: string) => table(name) }
}

let proposeAndPersist: typeof import('../../supabase/functions/inventory-propose/index.ts').proposeAndPersist

beforeEach(async () => {
  generateTextCalls.length = 0
  inserted.length = 0
  vi.resetModules()
  // The module ends in `Deno.serve(...)` behind a typeof guard; give it a
  // no-op so importing it does not start a server.
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: () => {} })
  ;({ proposeAndPersist } = await import('../../supabase/functions/inventory-propose/index.ts'))
})
afterEach(() => vi.unstubAllGlobals())

describe('proposeAndPersist writes a row Postgres accepts', () => {
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
