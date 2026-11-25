/**
 * FILE: packages/server/src/__tests__/llm-cost.test.ts
 * PURPOSE: Every LLM cost comes from the shared price book (priceFor), and a
 *          call the book cannot price is unpriced: never $0, never a
 *          fallback rate (owner rule, 2026-11-25).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isKnownModel,
  priceLlmCall,
  priceUsageFor,
  providerForModel,
  setLlmPriceSource,
  UsageByModel,
} from '../../supabase/functions/_shared/llm-cost.ts'
import { fixturePriceSource } from './fixtures/price-book.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')

afterEach(() => setLlmPriceSource(null))

describe('providerForModel', () => {
  it('names the provider from the id; a vendor prefix means OpenRouter', () => {
    expect(providerForModel('claude-sonnet-5-5')).toBe('anthropic')
    expect(providerForModel('gpt-6-luna')).toBe('openai')
    expect(providerForModel('text-embedding-3-small')).toBe('openai')
    expect(providerForModel('openai/gpt-5.4')).toBe('openrouter')
    expect(providerForModel('heuristic')).toBe('unknown')
  })
})

describe('priceUsageFor', () => {
  it('keeps Anthropic input as is: its input_tokens excludes the cache', () => {
    expect(priceUsageFor('anthropic', { model: 'x', inputTokens: 100, cacheReadTokens: 400, cacheWriteTokens: 50, outputTokens: 10 }))
      .toEqual({ input: 100, output: 10, cachedRead: 400, cacheWrite5m: 50 })
  })

  it('subtracts cached tokens from OpenAI input, which includes them', () => {
    expect(priceUsageFor('openai', { model: 'x', inputTokens: 1_000, cacheReadTokens: 400, outputTokens: 5 }))
      .toEqual({ input: 600, output: 5, cachedRead: 400, cacheWrite5m: 0 })
  })
})

describe('priceLlmCall', () => {
  it('prices from the book and says which row priced it', async () => {
    setLlmPriceSource(fixturePriceSource())
    const c = await priceLlmCall({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(c.costUsd).toBeCloseTo(12, 9)
    expect(c).toMatchObject({ provider: 'anthropic', source: 'pricing_page', version: '2026-01-01T00:00:00Z', tier: 'base', unpricedReason: null })
  })

  it('prices cache reads and writes at their own rates', async () => {
    setLlmPriceSource(fixturePriceSource())
    const c = await priceLlmCall({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })
    expect(c.costUsd).toBeCloseTo(2 + 0.1 + 2.5, 9)
  })

  it('applies the Haiku 5.5 long-prompt tier to the whole call above 100K prompt tokens', async () => {
    setLlmPriceSource(fixturePriceSource())
    expect((await priceLlmCall({ model: 'claude-haiku-5-5', inputTokens: 100_000, outputTokens: 1_000 })).costUsd).toBeCloseTo(0.0105, 9)
    const long = await priceLlmCall({ model: 'claude-haiku-5-5', inputTokens: 200_000, outputTokens: 1_000 })
    expect(long.costUsd).toBeCloseTo(0.1025, 9)
    expect(long.tier).toBe('prompt_tokens_gt:100000')
  })

  it('prices OpenRouter calls under the prefixed id', async () => {
    setLlmPriceSource(fixturePriceSource())
    const c = await priceLlmCall({ model: 'openai/gpt-5.4', inputTokens: 1_000_000, outputTokens: 0 })
    expect(c).toMatchObject({ provider: 'openrouter', model: 'openai/gpt-5.4', costUsd: 2.5 })
  })

  it('prices audio per second from units', async () => {
    setLlmPriceSource(fixturePriceSource())
    const c = await priceLlmCall({ model: 'gpt-transcribe', provider: 'openai', units: 60 })
    expect(c.costUsd).toBeCloseTo(0.0045, 9)
  })

  it('an unknown model is unpriced with a reason, never $0 or a fallback rate', async () => {
    setLlmPriceSource(fixturePriceSource())
    const c = await priceLlmCall({ model: 'claude-made-up-9', inputTokens: 1_000, outputTokens: 1_000 })
    expect(c.costUsd).toBeNull()
    expect(c.source).toBeNull()
    expect(c.unpricedReason).toMatch(/no price in force/)
  })

  it('a failed lookup is unpriced, not thrown', async () => {
    setLlmPriceSource({ book: () => Promise.reject(new Error('price bridge 503')) })
    const c = await priceLlmCall({ model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 10 })
    expect(c.costUsd).toBeNull()
    expect(c.unpricedReason).toMatch(/price bridge 503/)
  })

  it('without the wallet bridge configured every call is unpriced and says why', async () => {
    const c = await priceLlmCall({ model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 10 })
    expect(c.costUsd).toBeNull()
    expect(c.unpricedReason).toMatch(/KENSAURUS_WALLET_URL/)
  })

  it('zero usage costs $0 with source no_usage and makes no lookup', async () => {
    const src = fixturePriceSource()
    setLlmPriceSource(src)
    const c = await priceLlmCall({ model: 'heuristic', inputTokens: null, outputTokens: 0 })
    expect(c).toMatchObject({ costUsd: 0, source: 'no_usage', unpricedReason: null })
    expect(src.lookups).toBe(0)
  })

  it('an override in force beats the catalog', async () => {
    setLlmPriceSource(fixturePriceSource([
      { provider: 'anthropic', model: 'claude-sonnet-5-5', unit_kind: 'tokens', input_per_mtok_micro: 1_000_000, output_per_mtok_micro: 1_000_000, effective_from: '2026-02-01T00:00:00Z', source: 'manual' },
    ]))
    const c = await priceLlmCall({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(c.costUsd).toBeCloseTo(2, 9)
    expect(c.source).toBe('override:manual')
  })
})

describe('UsageByModel', () => {
  it('keeps tokens and cost per model, in first-use order', async () => {
    setLlmPriceSource(fixturePriceSource())
    const ledger = new UsageByModel()
    ledger.record('claude-haiku-4-5', 100, 20)
    ledger.record('claude-sonnet-5-5', 1_000, 800)
    ledger.record('claude-haiku-4-5', 50, 10)
    ledger.record('gpt-5.4-mini', 400, 300)
    const rows = await ledger.rows()
    expect(rows.map((r) => [r.model, r.inputTokens, r.outputTokens])).toEqual([
      ['claude-haiku-4-5', 150, 30],
      ['claude-sonnet-5-5', 1_000, 800],
      ['gpt-5.4-mini', 400, 300],
    ])
    // ceil per call, in micros: 100*1 + 20*5 = 200µ; 50*1 + 10*5 = 100µ.
    expect(rows[0]!.costUsd).toBeCloseTo(0.0003, 9)
    for (const r of rows) expect(r.model).not.toContain('+')
  })

  it('a run with an unpriced model has no total, not a partial one', async () => {
    setLlmPriceSource(fixturePriceSource())
    const ledger = new UsageByModel()
    ledger.record('claude-sonnet-5-5', 1_000, 800)
    ledger.record('claude-made-up-9', 400, 300)
    expect(await ledger.totalCostUsd()).toBeNull()
    expect((await ledger.rows())[1]!.unpricedReason).toMatch(/no price in force/)
  })

  it('is empty and costs nothing before any call', async () => {
    const ledger = new UsageByModel()
    expect(await ledger.rows()).toEqual([])
    expect(await ledger.totalCostUsd()).toBe(0)
  })
})

describe('isKnownModel', () => {
  it('knows the routed models, with or without a vendor prefix', () => {
    expect(isKnownModel('claude-sonnet-5-5')).toBe(true)
    expect(isKnownModel('openai/gpt-5.4')).toBe(true)
    expect(isKnownModel('gpt-4.1-2025-04-14')).toBe(false)
  })
})

describe('no local price table is left', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (p.endsWith('.ts')) out.push(p)
    }
    return out
  }

  it('the retired pricing.ts and its helpers are gone from every function', () => {
    for (const file of walk(FUNCTIONS)) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/LLM_PRICING_PER_M_TOKENS|LLM_PRICING_FALLBACK|estimateCallCostUsd|_shared\/pricing\.ts|from '\.\/pricing\.ts'/)
    }
  })

  it('stt.ts keeps no per-minute rate of its own', () => {
    const src = readFileSync(resolve(FUNCTIONS, '_shared/stt.ts'), 'utf8')
    expect(src).not.toMatch(/USD_PER_MINUTE|0\.0045|0\.003\b/)
    expect(src).toContain('priceLlmCall(')
  })

  it('price.ts is the byte-identical copy of the yen-yen spine source', () => {
    // The sha256 kensaurus-spine/edge/spine.lock.json (yen-yen) records for price.ts.
    // A re-sync with scripts/spine-sync.mjs updates both.
    const bytes = readFileSync(resolve(FUNCTIONS, '_shared/kensaurus/price.ts'), 'utf8').replace(/\r\n/g, '\n')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('d2c3225bc29ca553bce149a6213011b305c7e3d66a3ba530b2b080d84d1ccff8')
  })
})
