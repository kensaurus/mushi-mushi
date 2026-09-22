import { describe, expect, it } from 'vitest'
import { lastModifiedFromFrontMatter } from './sitemap-dates'

describe('lastModifiedFromFrontMatter', () => {
  it('omits lastmod for pages that do not date themselves', () => {
    expect(lastModifiedFromFrontMatter(undefined)).toBeUndefined()
    expect(lastModifiedFromFrontMatter({ title: 'Pricing' })).toBeUndefined()
    expect(lastModifiedFromFrontMatter({ date: 'soon' })).toBeUndefined()
  })

  it('reads a YAML date as parsed (Date) or as a string', () => {
    expect(lastModifiedFromFrontMatter({ date: new Date('2026-06-17') })?.toISOString()).toBe('2026-06-17T00:00:00.000Z')
    expect(lastModifiedFromFrontMatter({ date: '2026-09-21' })?.toISOString()).toBe('2026-09-21T00:00:00.000Z')
  })

  it('prefers an explicit update date over the publish date', () => {
    expect(
      lastModifiedFromFrontMatter({ date: '2026-06-17', updated: '2026-09-21' })?.toISOString(),
    ).toBe('2026-09-21T00:00:00.000Z')
  })
})
