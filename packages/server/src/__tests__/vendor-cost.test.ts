/**
 * FILE: packages/server/src/__tests__/vendor-cost.test.ts
 * PURPOSE: An OpenRouter call is recorded at the cost OpenRouter reported
 *          (price_source 'vendor_actual'), which beats the catalog estimate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openRouterUsageCostUsd,
  rememberVendorCost,
  takeVendorCost,
  withOpenRouterCostCapture,
} from '../../supabase/functions/_shared/vendor-cost.ts'
import { setLlmPriceSource } from '../../supabase/functions/_shared/llm-cost.ts'
import { fixturePriceSource } from './fixtures/price-book.ts'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

const { recordLlmUsage } = await import('../../supabase/functions/_shared/llm-usage.ts')

afterEach(() => setLlmPriceSource(null))

describe('openRouterUsageCostUsd', () => {
  it('is usage.cost on an OpenRouter-paid call', () => {
    expect(openRouterUsageCostUsd({ cost: 0.0123, is_byok: false })).toBe(0.0123)
  })
  it('adds the upstream charge on a BYOK route, and is unknown without it', () => {
    expect(openRouterUsageCostUsd({ cost: 0.001, is_byok: true, cost_details: { upstream_inference_cost: 0.02 } })).toBeCloseTo(0.021, 12)
    expect(openRouterUsageCostUsd({ cost: 0.001, is_byok: true, cost_details: { upstream_inference_cost: null } })).toBeNull()
  })
  it('is null when no cost is reported', () => {
    expect(openRouterUsageCostUsd({ prompt_tokens: 3 })).toBeNull()
    expect(openRouterUsageCostUsd(null)).toBeNull()
  })
})

describe('withOpenRouterCostCapture', () => {
  it('remembers the reported cost by generation id and leaves the response readable', async () => {
    const inner = vi.fn(async () => new Response(JSON.stringify({ id: 'gen-1', usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0042 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const res = await withOpenRouterCostCapture(inner as never)('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' })
    expect(((await res.json()) as { id: string }).id).toBe('gen-1')
    expect(takeVendorCost('gen-1')).toBe(0.0042)
    // Taken once.
    expect(takeVendorCost('gen-1')).toBeNull()
  })

  it('forgets a cost after ten minutes', () => {
    rememberVendorCost('gen-old', 1, 0)
    expect(takeVendorCost('gen-old', 11 * 60_000)).toBeNull()
  })
})

describe('the usage row', () => {
  it('stores the reported cost as vendor_actual instead of the catalog price', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    setLlmPriceSource(fixturePriceSource())
    rememberVendorCost('gen-42', 0.0517)
    const rows: Array<Record<string, unknown>> = []
    const db = { from: () => ({ insert: (row: Record<string, unknown>) => (rows.push(row), Promise.resolve({ error: null })) }) }
    await recordLlmUsage(db as never, { functionName: 'judge-batch', model: 'openai/gpt-5.4', keySource: 'byok' }, {
      result: { response: { id: 'gen-42' }, usage: { promptTokens: 1_000, completionTokens: 100 } },
    })
    expect(rows[0]).toMatchObject({ used_model: 'openai/gpt-5.4', input_tokens: 1_000, output_tokens: 100, cost_usd: 0.0517, price_source: 'vendor_actual' })
  })
})
