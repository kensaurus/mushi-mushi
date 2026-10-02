import { describe, expect, it } from 'vitest'
import type { PortfolioCard } from '../../lib/portfolioTypes'
import { kindLabel, radarLabel, sdkLabel, sortPortfolioCards } from './portfolioView'

const card = (over: Partial<PortfolioCard>): PortfolioCard => ({
  projectId: 'p',
  name: 'p',
  slug: null,
  kind: null,
  kindSource: 'unknown',
  worst: 'unknown',
  elements: {},
  error: null,
  openReports: 0,
  sdk: [],
  latestRelease: null,
  radar: { checkedAt: null, status: 'never_run', open: { error: 0, warn: 0, info: 0 }, unchecked: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, autofixCapUsd: null, monthlyLlmBudgetUsd: null },
  ...over,
})

describe('portfolioView', () => {
  it('puts the worst recipe state first, then the most open reports', () => {
    const out = sortPortfolioCards([
      card({ name: 'ok', worst: 'ok', openReports: 9 }),
      card({ name: 'err', worst: 'error' }),
      card({ name: 'drift-few', worst: 'drift', openReports: 1 }),
      card({ name: 'drift-many', worst: 'drift', openReports: 5 }),
    ])
    expect(out.map((c) => c.name)).toEqual(['err', 'drift-many', 'drift-few', 'ok'])
  })

  it('never shows a radar that has not run as a pass', () => {
    expect(radarLabel(card({}).radar)).toMatchObject({ text: 'Not checked yet', tone: 'neutral' })
    expect(radarLabel({ checkedAt: '2026-10-02T00:00:00Z', status: 'pass', open: { error: 0, warn: 0, info: 2 }, unchecked: 0 }).text).toBe('No holes found')
    expect(radarLabel({ checkedAt: '2026-10-02T00:00:00Z', status: 'fail', open: { error: 1, warn: 2, info: 0 }, unchecked: 0 })).toMatchObject({ text: '3 holes', tone: 'dangerSubtle' })
  })

  it('labels the SDK by its worst package and says unknown when nothing reported', () => {
    expect(sdkLabel([]).text).toBe('SDK unknown')
    expect(sdkLabel([
      { projectId: 'p', package: '@mushi-mushi/react-native', version: '0.21.0', latest: '0.21.0', status: 'current', reason: '' },
      { projectId: 'p', package: '@mushi-mushi/web', version: '1.28.0', latest: '1.29.0', status: 'behind', reason: '' },
    ]).text).toBe('SDK 1.28.0 → 1.29.0')
  })

  it('marks an inferred kind as inferred', () => {
    expect(kindLabel({ kind: 'app', kindSource: 'inferred' })).toBe('App (inferred)')
    expect(kindLabel({ kind: 'site', kindSource: 'declared' })).toBe('Site')
    expect(kindLabel({ kind: null, kindSource: 'unknown' })).toBe('Kind unknown')
  })
})
