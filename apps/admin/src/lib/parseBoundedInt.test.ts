import { describe, expect, it } from 'vitest'
import { parseBoundedInt, utcInputToIso } from './format'

describe('parseBoundedInt', () => {
  it('accepts whole numbers in range', () => {
    expect(parseBoundedInt('200', 10, 1000)).toBe(200)
    expect(parseBoundedInt(' 10 ', 10, 1000)).toBe(10)
  })

  it('rejects blanks, decimals, text and out-of-range values', () => {
    expect(parseBoundedInt('', 10, 1000)).toBeNull()
    expect(parseBoundedInt('12.5', 10, 1000)).toBeNull()
    expect(parseBoundedInt('abc', 10, 1000)).toBeNull()
    expect(parseBoundedInt('5', 10, 1000)).toBeNull()
    expect(parseBoundedInt('1001', 10, 1000)).toBeNull()
  })
})

describe('utcInputToIso', () => {
  it('reads a datetime-local value as UTC, whatever the browser timezone', () => {
    expect(utcInputToIso('2026-10-04T09:30')).toBe('2026-10-04T09:30:00.000Z')
    expect(utcInputToIso('2026-10-04T09:30:15')).toBe('2026-10-04T09:30:15.000Z')
  })

  it('rejects empty or malformed values', () => {
    expect(utcInputToIso('')).toBeNull()
    expect(utcInputToIso('yesterday')).toBeNull()
  })
})
