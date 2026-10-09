import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  meteredCall,
  setWalletDeadLetterSink,
  type PriceRow,
  type WalletBackend,
  type WalletDebitDeadLetter,
} from '../../supabase/functions/_shared/kensaurus-wallet.ts'

/**
 * A NaN or Infinity usage figure used to price out to NaN. JSON turns that into
 * null on the way to kensaurus_wallet_debit, which then failed on the ledger's
 * NOT NULL amount, was retried, and was reported as an opaque RPC error.
 * meteredCall now skips the debit and dead-letters the call with the real cause.
 */

const perUnit: PriceRow = {
  provider: 'openai',
  model: 'whisper-1',
  unit_kind: 'units',
  input_per_mtok_micro: null,
  output_per_mtok_micro: null,
  cached_input_per_mtok_micro: null,
  per_unit_micro: 100,
}

function fakeBackend() {
  const debit = vi.fn(async () => ({ balance_micro: 1_000, debit_micro: 150 }))
  const backend: WalletBackend = {
    check: async () => ({ allowed: true, balance_micro: 1_000_000 }),
    debit,
    getPrice: async () => perUnit,
  }
  return { backend, debit }
}

const baseOpts = (backend: WalletBackend) => ({
  backend,
  app: 'mushi',
  feature: 'test',
  provider: 'openai',
  model: `whisper-1-${Math.random()}`, // defeat the module price cache
})

afterEach(() => {
  setWalletDeadLetterSink(async () => {})
})

describe('meteredCall with a non-finite cost', () => {
  it.each([
    ['NaN units', { units: Number.NaN }],
    ['Infinity units', { units: Number.POSITIVE_INFINITY }],
  ])('skips the debit and dead-letters %s', async (_label, usage) => {
    const { backend, debit } = fakeBackend()
    const lost: WalletDebitDeadLetter[] = []
    setWalletDeadLetterSink(async (entry) => {
      lost.push(entry)
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const out = await meteredCall(baseOpts(backend), async () => ({ result: 'ok', usage }))

    expect(out).toEqual({ result: 'ok', debitMicro: 0, balanceMicro: null })
    expect(debit).not.toHaveBeenCalled()
    expect(lost).toHaveLength(1)
    expect(lost[0].providerCostMicro).toBe(0)
    expect(lost[0].error).toMatch(/^non-finite provider cost/)
    errSpy.mockRestore()
  })

  it('still debits a finite cost', async () => {
    const { backend, debit } = fakeBackend()
    const out = await meteredCall(baseOpts(backend), async () => ({ result: 'ok', usage: { units: 2 } }))
    expect(debit).toHaveBeenCalledTimes(1)
    expect(debit.mock.calls[0][0]).toMatchObject({ providerCostMicro: 200 })
    expect(out.debitMicro).toBe(150)
  })
})
