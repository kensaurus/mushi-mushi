import { describe, expect, it } from 'vitest'
import { releaseIdParam, releasesListTab } from './ReleasesPage'

describe('releasesListTab', () => {
  it('only the drafts and published lists carry the "No releases yet" first step', () => {
    expect(releasesListTab('drafts')).toBe(true)
    expect(releasesListTab('published')).toBe(true)
    expect(releasesListTab('batch')).toBe(false)
    expect(releasesListTab('store')).toBe(false)
    expect(releasesListTab('draft')).toBe(false)
  })
})

describe('releaseIdParam (/releases?release=<id> opens that release)', () => {
  it('takes a uuid and nothing else', () => {
    expect(releaseIdParam('2000000a-0000-4000-8000-000000000000')).toBe('2000000a-0000-4000-8000-000000000000')
    expect(releaseIdParam('../admin')).toBeNull()
    expect(releaseIdParam('')).toBeNull()
    expect(releaseIdParam(null)).toBeNull()
  })
})
