import { describe, expect, it } from 'vitest'
import { releasesListTab } from './ReleasesPage'

describe('releasesListTab', () => {
  it('only the drafts and published lists carry the "No releases yet" first step', () => {
    expect(releasesListTab('drafts')).toBe(true)
    expect(releasesListTab('published')).toBe(true)
    expect(releasesListTab('batch')).toBe(false)
    expect(releasesListTab('store')).toBe(false)
    expect(releasesListTab('draft')).toBe(false)
  })
})
