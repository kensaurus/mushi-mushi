/**
 * FILE: packages/server/src/__tests__/tremendous-redemption-worker.test.ts
 * PURPOSE: The gift-card worker never picks a Tremendous host on its own and
 *          never stores tester email or a redeem link in raw_payload.
 *
 * It defaulted TREMENDOUS_API_URL to the testflight sandbox, so a production
 * deploy missing the variable sent real redemptions to the sandbox; and it
 * stored the whole create-order response, which echoes the recipient email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { minimalTremendousPayload, scrubEmails } from '../../supabase/functions/_shared/tremendous-payload.ts'

const h = vi.hoisted(() => ({
  served: null as null | ((req: Request) => Promise<Response>),
  env: {} as Record<string, string | undefined>,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (fn: unknown) => fn }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))

const ORDER = {
  id: 'ord-1',
  tester_id: 'tester-1',
  redemption_id: 'red-1',
  amount_usd: 10,
  sku: 'AMAZON_GIFT_CARD',
  external_id: null,
  mushi_testers: { auth_user_id: 'user-1', display_name: 'T' },
}

function fakeDb() {
  const table = (name: string) => {
    const result = () => {
      if (name === 'mushi_runtime_config') return { data: { value: 'FUND_123' }, error: null }
      if (name === 'tremendous_orders') return { data: [ORDER], error: null }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {
      single: async () => result(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      update: (row: Record<string, unknown>) => {
        h.updates.push({ table: name, row })
        return b
      },
    }
    for (const m of ['select', 'eq', 'is', 'limit']) b[m] = () => b
    return b
  }
  return {
    from: (name: string) => table(name),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'tester@example.com' } } }) } },
  }
}
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))

const TREMENDOUS_ORDER = {
  order: {
    id: 'TREM-1',
    external_id: 'mushi-bounties:ord-1',
    status: 'EXECUTED',
    created_at: '2026-10-10T00:00:00Z',
    payment: { subtotal: 10, total: 10, fees: 0 },
    rewards: [{
      id: 'RWD-1',
      order_id: 'TREM-1',
      value: { denomination: 10, currency_code: 'USD' },
      products: ['AMAZON_GIFT_CARD'],
      recipient: { name: 'Tester', email: 'tester@example.com', phone: '+15555550100' },
      delivery: { method: 'EMAIL', status: 'SUCCEEDED', link: 'https://reward.example/redeem/secret' },
    }],
  },
}

const fetchMock = vi.fn()

beforeEach(async () => {
  h.served = null
  h.updates.length = 0
  h.env = { TREMENDOUS_API_KEY: 'key', TREMENDOUS_API_URL: 'https://testflight.tremendous.com/api/v2' }
  fetchMock.mockReset()
  vi.resetModules()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => h.env[k] },
    serve: (handler: (req: Request) => Promise<Response>) => {
      h.served = handler
    },
  })
  vi.stubGlobal('fetch', fetchMock)
  await import('../../supabase/functions/tremendous-redemption-worker/index.ts')
})
afterEach(() => vi.unstubAllGlobals())

const run = () => h.served!(new Request('https://edge.local/tremendous-redemption-worker', { method: 'POST' }))

describe('tremendous-redemption-worker', () => {
  it('refuses to run without an explicit TREMENDOUS_API_URL', async () => {
    delete h.env.TREMENDOUS_API_URL
    const res = await run()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'tremendous_api_url_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })

  it('posts to the configured host and stores no email or redeem link', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(TREMENDOUS_ORDER)))
    const res = await run()
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe('https://testflight.tremendous.com/api/v2/orders')
    const stored = h.updates.find((u) => u.table === 'tremendous_orders')!.row
    expect(stored).toMatchObject({ status: 'processing', external_id: 'TREM-1' })
    const json = JSON.stringify(stored.raw_payload)
    expect(json).not.toContain('tester@example.com')
    expect(json).not.toContain('redeem/secret')
    expect(json).not.toContain('+15555550100')
    expect(stored.raw_payload).toMatchObject({ order: { id: 'TREM-1', rewards: [{ id: 'RWD-1', delivery: { status: 'SUCCEEDED' } }] } })
  })

  it('scrubs an echoed email out of the stored error', async () => {
    fetchMock.mockResolvedValue(new Response('{"errors":{"message":"bad recipient tester@example.com"}}', { status: 400 }))
    await run()
    const stored = h.updates.find((u) => u.table === 'tremendous_orders')!.row
    expect(stored.status).toBe('pending')
    expect(String((stored.raw_payload as { last_error: string }).last_error)).not.toContain('tester@example.com')
    expect(String((stored.raw_payload as { last_error: string }).last_error)).toContain('[email]')
  })
})

describe('minimalTremendousPayload', () => {
  it('keeps a webhook event\'s ids and status but not the recipient', () => {
    const out = minimalTremendousPayload({ event: 'REWARDS.DELIVERY.SUCCEEDED', uuid: 'evt-1', ...TREMENDOUS_ORDER })
    expect(out).toMatchObject({ event: 'REWARDS.DELIVERY.SUCCEEDED', uuid: 'evt-1', order: { id: 'TREM-1', status: 'EXECUTED' } })
    expect(JSON.stringify(out)).not.toMatch(/recipient|tester@example\.com|redeem/)
  })

  it('returns an empty object for a non-object body', () => {
    expect(minimalTremendousPayload(null)).toEqual({})
    expect(minimalTremendousPayload('x')).toEqual({})
  })
})

describe('scrubEmails', () => {
  it('replaces every address and leaves the rest', () => {
    expect(scrubEmails('to a.b+c@x.co and "d@e.org"')).toBe('to [email] and "[email]"')
  })
})
