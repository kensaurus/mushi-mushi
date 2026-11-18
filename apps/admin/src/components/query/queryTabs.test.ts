/**
 * SQL query opens on the Ask box (console journeys 2026-10-27): no tab in
 * the address means Ask. The empty Overview tab is gone; old links land on
 * Schema, which now holds its developer details.
 */

import { describe, expect, it } from 'vitest'

import { QUERY_TABS, defaultLibraryTab, resolveQueryTab } from './queryTabs'

describe('resolveQueryTab', () => {
  it('opens on Ask', () => {
    expect(resolveQueryTab(null)).toBe('ask')
    expect(resolveQueryTab('nonsense')).toBe('ask')
  })
  it('keeps a deep link to another tab', () => {
    expect(resolveQueryTab('history')).toBe('history')
    expect(resolveQueryTab('schema')).toBe('schema')
  })
  it('sends the retired Overview tab to Schema, and no longer lists it', () => {
    expect(resolveQueryTab('overview')).toBe('schema')
    expect(QUERY_TABS.map((t) => t.id)).toEqual(['ask', 'history', 'schema'])
  })
})

describe('defaultLibraryTab', () => {
  it('opens on Recent when there are past queries, even with nothing saved', () => {
    expect(defaultLibraryTab(0, 25)).toBe('recent')
    expect(defaultLibraryTab(3, 25)).toBe('recent')
  })
  it('opens on Saved only when it is the one list with rows', () => {
    expect(defaultLibraryTab(4, 0)).toBe('saved')
    expect(defaultLibraryTab(0, 0)).toBe('recent')
  })
})
