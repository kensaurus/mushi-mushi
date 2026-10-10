/**
 * FILE: packages/server/src/__tests__/tremendous-redemption-worker.test.ts
 * PURPOSE: The gift-card worker never picks a Tremendous host on its own and
 *          never stores tester email or a redeem link in raw_payload.
 *
 * It defaulted TREMENDOUS_API_URL to the testflight sandbox, so a production
 * deploy missing the variable sent real redemptions to the sandbox; and it
 * stored the whole create-order response, which echoes the recipient email.
 *
 * Also: when it stops retrying (owner decision 2026-10-10). A non-retryable
 * 4xx or the 10th failure marks the order failed and withholds the
 * redemption for ops, without refunding points; 5xx/429/network failures
 * stay pending and back off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { minimalTremendousPayload, scrubEmails } from '../../supabase/functions/_shared/tremendous-payload.ts'
import {
  TREMENDOUS_MAX_ATTEMPTS,
  isRetryDue,
  onTremendousFailure,
} from '../../supabase/functions/_shared/tremendous-retry.ts'

const h = vi.hoisted(() => ({
  served: null as null | ((req: Request) => Promise<Response>),
  env: {} as Record<string, string | undefined>,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
  order: {} as Record<string, unknown>,
  email: 'tester@example.com' as string | null,
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
      if (name === 'tremendous_orders') return { data: [{ ...ORDER, ...h.order }], error: null }
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
    for (const m of ['select', 'eq', 'is', 'limit', 'order']) b[m] = () => b
    return b
  }
  return {
    from: (name: string) => table(name),
    auth: { admin: { getUserById: async () => ({ data: { user: h.email ? { email: h.email } : null } }) } },
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
  h.order = {}
  h.email = 'tester@example.com'
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
    expect(String((stored.raw_payload as { last_error: string }).last_error)).not.toContain('tester@example.com')
    expect(String((stored.raw_payload as { last_error: string }).last_error)).toContain('[email]')
  })

  it('gives up on a non-retryable 4xx: order failed, redemption withheld, no refund', async () => {
    fetchMock.mockResolvedValue(new Response('{"errors":{"message":"invalid product"}}', { status: 400 }))
    const res = await run()
    expect(await res.json()).toMatchObject({ gave_up: 1 })
    const order = h.updates.find((u) => u.table === 'tremendous_orders')!.row
    expect(order).toMatchObject({ status: 'failed', raw_payload: { attempts: 1, gave_up: 'tremendous_rejected_400' } })
    const redemption = h.updates.find((u) => u.table === 'tester_redemptions')!.row
    expect(redemption).toEqual({
      status: 'withheld',
      failure_reason: 'tremendous_rejected_400',
      withheld_reason: 'gift_card_order_failed',
    })
    // No refund: the worker touches no points/wallet table.
    expect(h.updates.map((u) => u.table).sort()).toEqual(['tester_redemptions', 'tremendous_orders'])
  })

  it('keeps a 5xx / 429 / network failure pending and counts the attempt', async () => {
    for (const failure of [
      () => Promise.resolve(new Response('down', { status: 503 })),
      () => Promise.resolve(new Response('slow down', { status: 429 })),
      () => Promise.reject(new TypeError('fetch failed')),
    ]) {
      h.updates.length = 0
      h.order = { raw_payload: { attempts: 2 }, last_synced_at: '2026-01-01T00:00:00Z' }
      fetchMock.mockReset().mockImplementation(failure)
      await run()
      expect(h.updates).toHaveLength(1)
      expect(h.updates[0]).toMatchObject({ table: 'tremendous_orders', row: { status: 'pending', raw_payload: { attempts: 3 } } })
    }
  })

  it('gives up after the 10th retryable failure', async () => {
    h.order = { raw_payload: { attempts: TREMENDOUS_MAX_ATTEMPTS - 1 }, last_synced_at: '2026-01-01T00:00:00Z' }
    fetchMock.mockResolvedValue(new Response('down', { status: 502 }))
    await run()
    expect(h.updates.find((u) => u.table === 'tremendous_orders')!.row).toMatchObject({
      status: 'failed',
      raw_payload: { attempts: 10, gave_up: 'tremendous_failed_after_10_attempts' },
    })
    expect(h.updates.find((u) => u.table === 'tester_redemptions')!.row).toMatchObject({ status: 'withheld' })
  })

  it('skips an order still inside its backoff window', async () => {
    h.order = { raw_payload: { attempts: 5 }, last_synced_at: new Date().toISOString() }
    await run()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })

  it('withholds (not fails) the redemption when the tester email is unknown', async () => {
    h.email = null
    await run()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.updates.find((u) => u.table === 'tester_redemptions')!.row).toEqual({
      status: 'withheld',
      failure_reason: 'tester_email_not_found',
      withheld_reason: 'gift_card_order_failed',
    })
  })
})

describe('tremendous retry policy', () => {
  it('retries 5xx, 408, 425, 429 and network errors; gives up at once on other 4xx', () => {
    for (const s of [500, 502, 503, 504, 408, 425, 429, null]) expect(onTremendousFailure(s, 0)).toEqual({ giveUp: false, attempts: 1 })
    for (const s of [400, 401, 403, 404, 409, 422]) expect(onTremendousFailure(s, 0)).toMatchObject({ giveUp: true, attempts: 1 })
  })

  it('gives up on the 10th failure', () => {
    expect(onTremendousFailure(503, 8)).toEqual({ giveUp: false, attempts: 9 })
    expect(onTremendousFailure(503, 9)).toMatchObject({ giveUp: true, attempts: 10 })
  })

  it('backs off 1, 2, 4 … minutes, capped at 2 hours', () => {
    const t0 = Date.parse('2026-10-10T00:00:00Z')
    const at = new Date(t0).toISOString()
    expect(isRetryDue(0, at, t0)).toBe(true)
    expect(isRetryDue(1, at, t0 + 59_000)).toBe(false)
    expect(isRetryDue(1, at, t0 + 60_000)).toBe(true)
    expect(isRetryDue(4, at, t0 + 7 * 60_000)).toBe(false)
    expect(isRetryDue(4, at, t0 + 8 * 60_000)).toBe(true)
    expect(isRetryDue(9, at, t0 + 119 * 60_000)).toBe(false)
    expect(isRetryDue(9, at, t0 + 120 * 60_000)).toBe(true)
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
