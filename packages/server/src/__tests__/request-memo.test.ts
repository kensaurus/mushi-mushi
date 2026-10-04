/**
 * FILE: packages/server/src/__tests__/request-memo.test.ts
 * PURPOSE: The nav-meta fan-out shares membership reads only inside its own
 *          async context. An ordinary request by the same user that overlaps
 *          the fan-out must read fresh, or a removed or demoted member keeps
 *          their old access while fan-outs stay in flight.
 */

import { describe, expect, it } from 'vitest'
import { fanoutMemo, withFanoutMemo } from '../../supabase/functions/_shared/request-memo.ts'

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('fanoutMemo', () => {
  it('shares one read inside a fan-out', async () => {
    let calls = 0
    const read = () => fanoutMemo('u1', 'k', async () => ++calls)
    const [a, b] = await withFanoutMemo('u1', () => Promise.all([read(), read()]))
    expect([a, b]).toEqual([1, 1])
    expect(calls).toBe(1)
  })

  it('does not share with a concurrent request outside the fan-out', async () => {
    let calls = 0
    const read = () => fanoutMemo('u1', 'k', async () => ++calls)
    const fanout = withFanoutMemo('u1', async () => {
      const first = await read()
      await tick()
      return first
    })
    await tick()
    const outside = await read()
    expect(await fanout).toBe(1)
    expect(outside).toBe(2)
  })

  it('reads fresh after the fan-out settles', async () => {
    let calls = 0
    const read = () => fanoutMemo('u1', 'k', async () => ++calls)
    await withFanoutMemo('u1', read)
    expect(await read()).toBe(2)
  })

  it('never shares across users', async () => {
    let calls = 0
    await withFanoutMemo('u1', () => fanoutMemo('u2', 'k', async () => ++calls))
    await withFanoutMemo('u1', () => fanoutMemo('u2', 'k', async () => ++calls))
    expect(calls).toBe(2)
  })

  it('evicts a rejected read so a retry runs again', async () => {
    let calls = 0
    await withFanoutMemo('u1', async () => {
      await expect(fanoutMemo('u1', 'k', async () => { calls++; throw new Error('x') })).rejects.toThrow('x')
      await fanoutMemo('u1', 'k', async () => ++calls)
    })
    expect(calls).toBe(2)
  })
})
