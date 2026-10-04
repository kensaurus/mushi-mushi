import { describe, expect, it } from 'vitest'
import { exploreActionLabelFor, exploreTabSearchParams } from './exploreTabNavigation'

describe('exploreTabSearchParams', () => {
  it('writes tab=graph explicitly so Beginner/Quickstart do not redirect away', () => {
    const next = exploreTabSearchParams(new URLSearchParams('tab=ask&project=p1'), 'graph')
    expect(next.get('tab')).toBe('graph')
    expect(next.get('project')).toBe('p1')
  })

  it('switches between other tabs', () => {
    expect(exploreTabSearchParams(new URLSearchParams(''), 'tour').get('tab')).toBe('tour')
  })
})

describe('exploreActionLabelFor', () => {
  it('names the tab the banner actually opens', () => {
    expect(exploreActionLabelFor('/explore?tab=index&project=p1')).toBe('Open Index')
    expect(exploreActionLabelFor('/explore?tab=ask&project=p1')).toBe('Open Ask')
    expect(exploreActionLabelFor('/explore?tab=graph')).toBe('Open Graph')
    expect(exploreActionLabelFor('/connect')).toBe('Open Connect')
  })
})
