import { describe, expect, it } from 'vitest'
import {
  defaultTabForPrimary,
  exploreActionLabelFor,
  exploreTabSearchParams,
  primaryTabOf,
  resolveExploreTab,
} from './exploreTabNavigation'

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

describe('default map view', () => {
  it('lands on Layers, not the graph that renders a big repo as a strip', () => {
    expect(resolveExploreTab(null)).toBe('layers')
    expect(defaultTabForPrimary('map')).toBe('layers')
    expect(resolveExploreTab('graph')).toBe('graph')
  })

  // Unknown values share that fallback. Layers is the default map view:
  // the force graph drew 850 files as a strip (2026-10-08 review).
  it('falls back unknown tabs to layers', () => {
    expect(resolveExploreTab('bogus')).toBe('layers')
  })
})

describe('primary groups', () => {
  it('resolves knowledge as understand primary', () => {
    expect(resolveExploreTab('knowledge')).toBe('knowledge')
    expect(primaryTabOf('knowledge')).toBe('understand')
  })

  it('defaults understand primary to ask', () => {
    expect(defaultTabForPrimary('understand')).toBe('ask')
  })
})
