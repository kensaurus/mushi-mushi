/**
 * FILE: packages/server/src/__tests__/customer-price-sources.test.ts
 * PURPOSE: Customer prices have one source (cost catalog, 2026-11-25): the
 *          annual plan price is the Stripe Price object, and "Add price" on
 *          the Costs page writes a validated override through the bridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { overrideRow, parsePriceOverride, writePriceOverride } from '../../supabase/functions/_shared/price-override.ts'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
// stripe.ts (through support.ts) reads Deno.env when it loads.
vi.stubGlobal('Deno', { env: { get: () => undefined } })
const { annualDiscountPct, annualPricesByPlan, annualUsdFromPrice, resetAnnualPriceCache } = await import(
  '../../supabase/functions/_shared/plan-annual-prices.ts'
)

afterEach(() => resetAnnualPriceCache())

const yearly = (unit_amount: number) => ({ id: 'price_x', active: true, currency: 'usd', unit_amount, recurring: { interval: 'year', interval_count: 1 } })

describe('annual plan prices', () => {
  it('reads USD a year from a one-year Stripe price, and nothing else', () => {
    expect(annualUsdFromPrice(yearly(29_000))).toBe(290)
    expect(annualUsdFromPrice({ ...yearly(29_000), recurring: { interval: 'month', interval_count: 1 } })).toBeNull()
    expect(annualUsdFromPrice({ ...yearly(29_000), currency: 'jpy' })).toBeNull()
    expect(annualUsdFromPrice({ ...yearly(29_000), active: false })).toBeNull()
    expect(annualUsdFromPrice(null)).toBeNull()
  })

  it('derives the saving from the two prices (Builder $29/mo vs $290/yr = 17%)', () => {
    expect(annualDiscountPct(29, 290)).toBe(17)
    expect(annualDiscountPct(79, 790)).toBe(17)
    expect(annualDiscountPct(29, 400)).toBeNull()
    expect(annualDiscountPct(29, null)).toBeNull()
  })

  it('maps each paid plan to its Stripe annual price and does not cache a failed read', async () => {
    const retrieve = vi.fn(async (_cfg: unknown, id: string) => {
      if (id === 'price_pro') throw new Error('stripe down')
      return yearly(29_000)
    })
    const env = (k: string) => ({ STRIPE_PRICE_INDIE_ANNUAL: 'price_indie', STRIPE_PRICE_PRO_ANNUAL: 'price_pro' } as Record<string, string>)[k]
    const cfg = { secretKey: 'sk_test_x' } as never
    expect(await annualPricesByPlan({ cfg, env, retrieve: retrieve as never })).toEqual({ indie: 290, pro: null })
    await annualPricesByPlan({ cfg, env, retrieve: retrieve as never })
    expect(retrieve).toHaveBeenCalledTimes(4)
  })

  it('without a Stripe key offers no annual price', async () => {
    expect(await annualPricesByPlan({ cfg: { secretKey: '' } as never, env: () => 'price_x' })).toEqual({})
  })
})

describe('price override', () => {
  const body = { provider: 'Anthropic', model: 'claude-new-6', input_usd_per_mtok: 3, output_usd_per_mtok: 15, source_url: 'https://platform.claude.com/docs/en/about-claude/pricing' }

  it('validates dollars per 1M tokens and stores integer micros', () => {
    const p = parsePriceOverride(body)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const row = overrideRow(p.value, 'mushi-console:u1', new Date('2026-11-25T00:00:00Z'))
    expect(row).toMatchObject({
      provider: 'anthropic', model_or_unit: 'claude-new-6', unit_kind: 'tokens',
      input_per_mtok_micro: 3_000_000, output_per_mtok_micro: 15_000_000,
      effective_from: '2026-11-25T00:00:00.000Z', created_by: 'mushi-console:u1',
    })
    // The bridge's schema is strict: no `source` (always 'manual'), no null optional keys.
    expect(row).not.toHaveProperty('source')
    expect(row).not.toHaveProperty('cached_input_per_mtok_micro')
    expect(String(row.note)).toMatch(/Mushi Mushi console.*claude-new-6/)
  })

  it('refuses a missing rate, a typo-sized rate, an unknown provider and a non-https source', () => {
    expect(parsePriceOverride({ ...body, output_usd_per_mtok: undefined }).ok).toBe(false)
    expect(parsePriceOverride({ ...body, input_usd_per_mtok: 3_000_000 }).ok).toBe(false)
    expect(parsePriceOverride({ ...body, input_usd_per_mtok: '3' }).ok).toBe(false)
    expect(parsePriceOverride({ ...body, provider: 'unknown' }).ok).toBe(false)
    expect(parsePriceOverride({ ...body, source_url: 'http://x.example' }).ok).toBe(false)
  })

  it('reports an unconfigured install and a bridge without the action, never a silent success', async () => {
    expect(await writePriceOverride({}, { url: '', token: '' })).toMatchObject({ ok: false, code: 'NOT_CONFIGURED', status: 503 })
    const fetchImpl = vi.fn(async () => new Response('{"error":"Invalid body"}', { status: 400 }))
    expect(await writePriceOverride({}, { url: 'https://bridge.example', token: 't', fetchImpl: fetchImpl as never })).toMatchObject({ ok: false, code: 'BRIDGE_UNSUPPORTED' })
    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(sent).toMatchObject({ action: 'price_override', external_project: 'mushi' })
    const exists = vi.fn(async () => new Response('{"error":"override-exists"}', { status: 409 }))
    expect(await writePriceOverride({}, { url: 'https://bridge.example', token: 't', fetchImpl: exists as never })).toMatchObject({ ok: false, code: 'OVERRIDE_EXISTS' })
    const invalid = vi.fn(async () => new Response('{"error":"override-invalid"}', { status: 400 }))
    expect(await writePriceOverride({}, { url: 'https://bridge.example', token: 't', fetchImpl: invalid as never })).toMatchObject({ ok: false, code: 'OVERRIDE_INVALID' })
  })
})
