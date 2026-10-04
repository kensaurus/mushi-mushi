import { describe, expect, it } from 'vitest'
import { matchesQaCoverageFilter, resolveQaCoverageFilter } from './qaCoverageFilter'
import { qaCoverageLinks } from './statCardLinks'

const params = (q: string) => new URLSearchParams(q)

describe('resolveQaCoverageFilter', () => {
  it('reads the tab the stat cards and banner link to', () => {
    expect(resolveQaCoverageFilter(params('tab=failing&highlight=abc'))).toBe('failing')
    expect(resolveQaCoverageFilter(params('tab=passing'))).toBe('passing')
    expect(resolveQaCoverageFilter(params('tab=disabled'))).toBe('disabled')
    expect(resolveQaCoverageFilter(params('tab=no_data'))).toBe('no_data')
  })

  it('treats stories / overview / nothing as all', () => {
    expect(resolveQaCoverageFilter(params('tab=stories'))).toBe('all')
    expect(resolveQaCoverageFilter(params('tab=overview'))).toBe('all')
    expect(resolveQaCoverageFilter(params(''))).toBe('all')
  })

  it('honours the legacy status=fail link', () => {
    expect(resolveQaCoverageFilter(params('status=fail'))).toBe('failing')
  })

  it('every stat-card link resolves to a filter that is not silently ignored', () => {
    expect(resolveQaCoverageFilter(params(qaCoverageLinks.failing.split('?')[1]!))).toBe('failing')
    expect(resolveQaCoverageFilter(params(qaCoverageLinks.passing.split('?')[1]!))).toBe('passing')
    expect(resolveQaCoverageFilter(params(qaCoverageLinks.noData.split('?')[1]!))).toBe('no_data')
  })
})

describe('matchesQaCoverageFilter', () => {
  const failing = { enabled: true, runs_24h: 4, pass_rate_pct: 50 }
  const passing = { enabled: true, runs_24h: 4, pass_rate_pct: 100 }
  const idle = { enabled: true, runs_24h: 0, pass_rate_pct: null }
  const off = { enabled: false, runs_24h: 0, pass_rate_pct: null }

  it('uses the stats-route thresholds', () => {
    expect(matchesQaCoverageFilter(failing, 'failing')).toBe(true)
    expect(matchesQaCoverageFilter(passing, 'failing')).toBe(false)
    expect(matchesQaCoverageFilter(passing, 'passing')).toBe(true)
    expect(matchesQaCoverageFilter({ ...passing, pass_rate_pct: 80 }, 'passing')).toBe(true)
    expect(matchesQaCoverageFilter(idle, 'no_data')).toBe(true)
    expect(matchesQaCoverageFilter(idle, 'failing')).toBe(false)
  })

  it('filters turned-off stories', () => {
    expect(matchesQaCoverageFilter(off, 'disabled')).toBe(true)
    expect(matchesQaCoverageFilter(failing, 'disabled')).toBe(false)
    expect(matchesQaCoverageFilter(off, 'all')).toBe(true)
  })
})
