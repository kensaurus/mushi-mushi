import { describe, expect, it } from 'vitest'
import { roundLongDecimals } from './format'

describe('roundLongDecimals', () => {
  // Owner's walkthrough, 2026-11-17: "The alarm recorded 15.341893476 GB".
  it('rounds raw values for reading, and leaves whole numbers, short decimals and versions alone', () => {
    expect(roundLongDecimals('The alarm recorded 15.341893476 GB, above the 15 GB threshold')).toBe('The alarm recorded 15.34 GB, above the 15 GB threshold')
    expect(roundLongDecimals('0.000123456 · 1234.56789 · 7444 ms · v1.2.3 · 3442.8 ms · 15.0')).toBe('0.000123 · 1234.6 · 7444 ms · v1.2.3 · 3442.8 ms · 15.0')
  })
})
