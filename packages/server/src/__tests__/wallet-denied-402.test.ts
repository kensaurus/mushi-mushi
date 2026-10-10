/**
 * FILE: packages/server/src/__tests__/wallet-denied-402.test.ts
 * PURPOSE: An empty hosted-LLM wallet surfaces as a 402 with `reason` and
 *          `balanceMicro`, not a generic 500.
 *
 * story-mapper and inventory-propose rethrow WalletDeniedError out of their
 * retry loops so the caller can prompt a top-up, but both request handlers
 * caught it as a generic failure and answered 500 (MAPPER_FAILED /
 * PROPOSE_FAILED), and the /propose API hop turned every non-2xx into a 500.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class WalletDeniedError extends Error {
    reason: string
    balanceMicro: number | null
    constructor(reason: string, balanceMicro: number | null) {
      super(`wallet denied: ${reason}`)
      this.reason = reason
      this.balanceMicro = balanceMicro
    }
  }
  return {
    WalletDeniedError,
    served: null as null | ((req: Request) => Promise<Response>),
    updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
  }
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
// story-mapper passes the bare handler, inventory-propose passes (name, handler).
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (...args: unknown[]) => args[args.length - 1],
  tagLangfuseTrace: () => {},
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/llm-failover.ts', () => ({
  withLlmFailover: async () => {
    throw new h.WalletDeniedError('insufficient', 1234)
  },
  WalletDeniedError: h.WalletDeniedError,
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: async () => ({ key: 'fc-key' }) }))
vi.mock('../../supabase/functions/_shared/inventory-guards.ts', () => ({ assertSafeOutboundUrl: () => ({ ok: true }) }))
vi.mock('../../supabase/functions/_shared/inventory.ts', () => ({
  validateInventoryObject: (o: unknown) => ({ ok: true, inventory: o, issues: [] }),
}))
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({ id: 't1', span: () => ({ end: () => {} }), end: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/claude-messages.ts', () => ({ claudeGenerateText: async () => ({ text: '' }) }))
vi.mock('../../supabase/functions/_shared/llm-usage.ts', () => ({ withLlmUsage: async () => ({}) }))
vi.mock('../../supabase/functions/_shared/safe-error.ts', () => ({
  safeErrorResponse: (o: { code?: string; status?: number }) =>
    new Response(JSON.stringify({ ok: false, error: { code: o.code } }), { status: o.status ?? 500 }),
}))
vi.mock('../../supabase/functions/_shared/validate.ts', () => ({
  parseBody: async () => ({ ok: true, data: { project_id: 'p1' } }),
  InventoryProposeBodySchema: {},
}))
vi.mock('../../supabase/functions/_shared/prompt-ab.ts', () => ({
  getPromptForStage: async () => ({ promptTemplate: null }),
}))

// The proposer needs at least three observed routes before it calls a model.
const OBSERVATIONS = ['/home', '/settings', '/billing'].map((route) => ({
  route,
  observation_count: 5,
  project_id: 'p1',
  latest_title: route,
  latest_dom_summary: null,
  observed_testids: [],
  observed_apis: [],
  distinct_users: 2,
}))

/** Chainable PostgREST stand-in; records updates so the run row can be checked. */
function fakeDb() {
  const table = (name: string) => {
    const result = () => {
      if (name === 'discovery_observed_inventory') return { data: OBSERVATIONS, error: null }
      if (name === 'projects') return { data: { name: 'App', slug: 'app' }, error: null }
      if (name === 'inventories') return { data: { parsed: null }, error: null }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      update: (row: Record<string, unknown>) => {
        h.updates.push({ table: name, row })
        return b
      },
    }
    for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) b[m] = () => b
    return b
  }
  return { from: (name: string) => table(name) }
}
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))

beforeEach(() => {
  h.served = null
  h.updates.length = 0
  vi.resetModules()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => (k === 'FIRECRAWL_API_KEY' ? 'fc-key' : undefined) },
    serve: (handler: (req: Request) => Promise<Response>) => {
      h.served = handler
    },
  })
  // Firecrawl map → no extra links; scraping the base URL returns a page.
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).endsWith('/map')
      ? new Response(JSON.stringify({ links: ['https://app.example.com/'] }))
      : new Response(JSON.stringify({ data: { markdown: '# Home', metadata: { title: 'Home' } } })),
  ))
})
afterEach(() => vi.unstubAllGlobals())

function post(body: unknown): Request {
  return new Request('https://edge.local/fn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function expectWallet402(res: Response) {
  expect(res.status).toBe(402)
  const json = await res.json() as { ok: boolean; error: Record<string, unknown> }
  expect(json.ok).toBe(false)
  expect(json.error).toMatchObject({ code: 'WALLET_INSUFFICIENT', reason: 'insufficient', balanceMicro: 1234 })
}

describe('a wallet refusal is a 402, not a 500', () => {
  it('story-mapper answers 402 and records the refusal on the run', async () => {
    await import('../../supabase/functions/story-mapper/index.ts')
    expect(h.served).toBeTypeOf('function')
    const res = await h.served!(post({ run_id: 'run-1', project_id: 'p1', base_url: 'https://app.example.com' }))
    await expectWallet402(res)
    const failed = h.updates.find((u) => u.table === 'story_map_runs' && u.row.status === 'failed')
    expect(failed?.row.error_message).toBe('wallet denied: insufficient')
  })

  it('inventory-propose answers 402', async () => {
    await import('../../supabase/functions/inventory-propose/index.ts')
    expect(h.served).toBeTypeOf('function')
    await expectWallet402(await h.served!(post({ project_id: 'p1' })))
  })

  it('the /propose API hop keeps the 402 instead of turning it into a 500', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/inventory.ts'), 'utf8')
    expect(src).toMatch(/error: json\.error \?\? \{ code: 'PROPOSE_FAILED' \} \},\s*resp\.status === 402 \? 402 : 500,/)
  })
})
