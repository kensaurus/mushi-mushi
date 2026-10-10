/**
 * FILE: packages/server/src/__tests__/llm-failover-wallet.test.ts
 * PURPOSE: The hosted-LLM wallet path in withLlmFailover — preflight before a
 *          platform-key call, no preflight for BYOK, and the `meter` debit —
 *          runs in CI.
 *
 * `_shared/llm-failover.test.ts` covers the same module under Deno, but the
 * deno-check workflow runs no tests under `_shared/`, so before this file
 * nothing in CI exercised the wallet code before MUSHI_HOSTED_LLM_BILLING=on.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
    candidates: [] as Array<{ keyId: string | null; key: string; source: 'byok' | 'env'; hint: string }>,
    preflight: vi.fn(),
    charge: vi.fn(),
  }
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  enforceLlmBudget: async () => {},
  resolveLlmKeys: async () => h.candidates,
  markKeyStatus: async () => {},
  markKeyUsed: async () => {},
}))
vi.mock('../../supabase/functions/_shared/hosted-llm-billing.ts', () => ({
  hostedLlmPreflight: (...args: unknown[]) => h.preflight(...args),
  scheduleHostedLlmCharge: (...args: unknown[]) => h.charge(...args),
  providerFromModel: () => 'anthropic',
  WalletDeniedError: h.WalletDeniedError,
}))

const ENV = { keyId: null, key: 'platform', source: 'env' as const, hint: 'env' }
const BYOK = { keyId: 'k1', key: 'sk-own', source: 'byok' as const, hint: 'sk-…own' }
const METER = {
  feature: 'test-feature',
  model: 'claude-haiku-5-5',
  extractUsage: (r: { in: number; out: number }) => ({ inputTokens: r.in, outputTokens: r.out }),
}

let failover: typeof import('../../supabase/functions/_shared/llm-failover.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  failover = await import('../../supabase/functions/_shared/llm-failover.ts')
})

beforeEach(() => {
  h.preflight.mockReset()
  h.charge.mockReset()
  h.candidates = []
})

describe('withLlmFailover and the hosted-LLM wallet', () => {
  it('refuses a platform-key call the wallet denies, before the provider is called', async () => {
    h.candidates = [ENV]
    h.preflight.mockResolvedValue({ allowed: false, reason: 'insufficient', balanceMicro: 42 })
    const fn = vi.fn(async () => 'never')
    const err = await failover.withLlmFailover({} as never, 'p1', 'anthropic', fn).catch((e) => e)
    expect(err).toBeInstanceOf(h.WalletDeniedError)
    expect(err).toMatchObject({ reason: 'insufficient', balanceMicro: 42 })
    expect(fn).not.toHaveBeenCalled()
    expect(h.preflight).toHaveBeenCalledWith({ db: {}, projectId: 'p1' })
  })

  it('never checks the wallet for a BYOK key', async () => {
    h.candidates = [BYOK]
    const out = await failover.withLlmFailover({} as never, 'p1', 'anthropic', async () => 'ok', METER as never)
    expect(out).toBe('ok')
    expect(h.preflight).not.toHaveBeenCalled()
    // BYOK is the customer's own provider bill: no wallet debit either.
    expect(h.charge).not.toHaveBeenCalled()
  })

  it('debits a metered platform-key call once, with the extracted usage', async () => {
    h.candidates = [ENV]
    h.preflight.mockResolvedValue({ allowed: true, balanceMicro: null })
    const out = await failover.withLlmFailover({} as never, 'p1', 'anthropic', async () => ({ in: 10, out: 20 }), METER)
    expect(out).toEqual({ in: 10, out: 20 })
    expect(h.charge).toHaveBeenCalledTimes(1)
    expect(h.charge.mock.calls[0][0]).toMatchObject({
      projectId: 'p1',
      feature: 'test-feature',
      model: 'claude-haiku-5-5',
      usage: { inputTokens: 10, outputTokens: 20 },
    })
  })

  it('does not debit a platform-key call without a meter (logLlmInvocation bills those)', async () => {
    h.candidates = [ENV]
    h.preflight.mockResolvedValue({ allowed: true, balanceMicro: null })
    await failover.withLlmFailover({} as never, 'p1', 'anthropic', async () => 'ok')
    expect(h.charge).not.toHaveBeenCalled()
  })
})
