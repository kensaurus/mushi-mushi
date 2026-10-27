/**
 * SQL query opens on the Ask box (console journeys 2026-10-27): no tab in
 * the address means Ask, and the old Overview stays one click away.
 */

import { describe, expect, it } from 'vitest'

import { resolveQueryTab } from './queryTabs'

describe('resolveQueryTab', () => {
  it('opens on Ask', () => {
    expect(resolveQueryTab(null)).toBe('ask')
    expect(resolveQueryTab('nonsense')).toBe('ask')
  })
  it('keeps a deep link to another tab', () => {
    expect(resolveQueryTab('overview')).toBe('overview')
    expect(resolveQueryTab('history')).toBe('history')
  })
})
