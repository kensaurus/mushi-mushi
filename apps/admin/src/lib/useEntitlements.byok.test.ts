/**
 * Your own keys work on every plan since 2026-10-28: the key panels lock only
 * when the plan answered and lacks `byok`, never on a pending or failed read.
 */

import { describe, expect, it } from 'vitest'
import { isByokLocked } from './useEntitlements'

const has = (on: boolean) => () => on

describe('isByokLocked', () => {
  it('stays open on Free once the plan grants byok', () => {
    expect(isByokLocked({ loading: false, error: null, has: has(true) })).toBe(false)
  })

  it('stays open while entitlements load or after they fail', () => {
    expect(isByokLocked({ loading: true, error: null, has: has(false) })).toBe(false)
    expect(isByokLocked({ loading: false, error: 'Request failed', has: has(false) })).toBe(false)
  })

  it('locks only when the plan answered without byok', () => {
    expect(isByokLocked({ loading: false, error: null, has: has(false) })).toBe(true)
  })
})
