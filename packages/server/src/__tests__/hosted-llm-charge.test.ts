import { describe, expect, it } from 'vitest'
import {
  decideHostedLlmCharge,
  type HostedLlmChargeDecision,
} from '../../supabase/functions/_shared/hosted-llm-charge.ts'
import type { PriceRow } from '../../supabase/functions/_shared/kensaurus-wallet.ts'

/**
 * Regression cover for Sentry MUSHI-MUSHI-SERVER-1Z — "No wallet price for
 * hosted model — call not charged".
 *
 * The invariant under test: a hosted-key call must never be debited zero.
 * Every way of arriving at zero is a measurement failure and has to be
 * reported as unbillable so the caller dead-letters it, rather than silently
 * giving the work away.
 */

const tokens = (over: Partial<PriceRow> = {}): PriceRow => ({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  unit_kind: 'tokens',
  input_per_mtok_micro: 3_000_000,
  output_per_mtok_micro: 15_000_000,
  cached_input_per_mtok_micro: null,
  per_unit_micro: null,
  ...over,
})

const seconds = (over: Partial<PriceRow> = {}): PriceRow => ({
  provider: 'openai',
  model: 'gpt-transcribe',
  unit_kind: 'seconds',
  input_per_mtok_micro: null,
  output_per_mtok_micro: null,
  cached_input_per_mtok_micro: null,
  per_unit_micro: 75,
  ...over,
})

function expectSkip(decision: HostedLlmChargeDecision): Extract<
  HostedLlmChargeDecision,
  { kind: 'skip' }
> {
  expect(decision.kind).toBe('skip')
  if (decision.kind !== 'skip') throw new Error('unreachable')
  return decision
}

describe('decideHostedLlmCharge', () => {
  it('refuses to bill a model with no price row', () => {
    const decision = decideHostedLlmCharge({
      price: null,
      usage: { inputTokens: 1000, outputTokens: 500 },
      provider: 'openai',
      model: 'gpt-transcribe',
    })
    const skip = expectSkip(decision)
    expect(skip.reason).toBe('no-price-row')
    expect(skip.detail).toContain('openai:gpt-transcribe')
  })

  /**
   * THE BUG THAT OUTLIVED THE FIX. Adding the `gpt-transcribe` row silenced
   * the Sentry error, but telemetry still supplied only token counts, so a
   * seconds-priced model metered at `0 units * 75 micro` = 0 and the call was
   * debited nothing. Before this change that produced a $0 debit and no
   * signal at all.
   */
  it('refuses to bill a seconds-priced model when no audio duration was captured', () => {
    const decision = decideHostedLlmCharge({
      price: seconds(),
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: 'openai',
      model: 'gpt-transcribe',
    })
    const skip = expectSkip(decision)
    expect(skip.reason).toBe('zero-cost')
    expect(skip.detail).toContain('units=absent')
  })

  it('bills a seconds-priced model once the duration is plumbed through', () => {
    const decision = decideHostedLlmCharge({
      price: seconds(),
      usage: { inputTokens: 0, outputTokens: 0, units: 12 },
      provider: 'openai',
      model: 'gpt-transcribe',
    })
    // 12 s * 75 micro/s = 900 micro = $0.0009, i.e. $0.0045/min.
    expect(decision).toEqual({ kind: 'charge', providerCostMicro: 900 })
  })

  it('bills the cheaper fallback STT model at its own rate', () => {
    const decision = decideHostedLlmCharge({
      price: seconds({ model: 'gpt-4o-mini-transcribe', per_unit_micro: 50 }),
      usage: { units: 60 },
      provider: 'openai',
      model: 'gpt-4o-mini-transcribe',
    })
    expect(decision).toEqual({ kind: 'charge', providerCostMicro: 3000 })
  })

  it('refuses a chars-priced model with no unit count', () => {
    const decision = decideHostedLlmCharge({
      price: seconds({ provider: 'elevenlabs', model: 'tts', unit_kind: 'chars', per_unit_micro: 150 }),
      usage: {},
      provider: 'elevenlabs',
      model: 'tts',
    })
    expectSkip(decision)
  })

  it('refuses a priced row whose rate columns are NULL', () => {
    const decision = decideHostedLlmCharge({
      price: tokens({ input_per_mtok_micro: null, output_per_mtok_micro: null }),
      usage: { inputTokens: 5000, outputTokens: 900 },
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    const skip = expectSkip(decision)
    expect(skip.reason).toBe('zero-cost')
  })

  it('refuses a token model whose usage arrived as 0/0', () => {
    const decision = decideHostedLlmCharge({
      price: tokens(),
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expectSkip(decision)
  })

  /**
   * Matches a real production ledger row: 3539 in + 689 out on Sonnet 4.6
   * recorded shadow_provider_cost_micro = 20952. Proves the refactor did not
   * change the arithmetic for the models that already billed correctly.
   */
  it('reproduces the live token cost exactly', () => {
    const decision = decideHostedLlmCharge({
      price: tokens(),
      usage: { inputTokens: 3539, outputTokens: 689, cachedInputTokens: 0 },
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expect(decision).toEqual({ kind: 'charge', providerCostMicro: 20952 })
  })

  it('prices cached input tokens off the cached rate when present', () => {
    const decision = decideHostedLlmCharge({
      price: tokens({ cached_input_per_mtok_micro: 300_000 }),
      usage: { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 },
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
    expect(decision).toEqual({ kind: 'charge', providerCostMicro: 3_300_000 })
  })

  it('never returns a charge of zero for any input', () => {
    const cases: Array<{ price: PriceRow | null; usage: Record<string, number> }> = [
      { price: null, usage: {} },
      { price: seconds(), usage: {} },
      { price: seconds({ per_unit_micro: null }), usage: { units: 30 } },
      { price: tokens(), usage: {} },
      { price: tokens(), usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    for (const { price, usage } of cases) {
      const decision = decideHostedLlmCharge({ price, usage, provider: 'p', model: 'm' })
      expect(decision.kind).toBe('skip')
    }
  })
})
