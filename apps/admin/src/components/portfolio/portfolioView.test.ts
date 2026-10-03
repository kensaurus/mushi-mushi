import { describe, expect, it } from 'vitest'
import type { PortfolioCard } from '../../lib/portfolioTypes'
import {
  budgetText,
  kindLabel,
  openReportsText,
  radarLabel,
  radarStateMeta,
  releaseText,
  sdkLabel,
  sortPortfolioCards,
  spendText,
} from './portfolioView'

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
  radar: { checkedAt: null, status: 'never_run', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
  unreadable: [],
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
    expect(radarLabel({ checkedAt: '2026-10-02T00:00:00Z', status: 'pass', open: { error: 0, warn: 0, info: 2 }, unchecked: 0, errored: 0 }).text).toBe('No holes found')
    expect(radarLabel({ checkedAt: '2026-10-02T00:00:00Z', status: 'fail', open: { error: 1, warn: 2, info: 0 }, unchecked: 0, errored: 0 })).toMatchObject({ text: '3 holes', tone: 'dangerSubtle' })
    // A check that failed to run is never green.
    expect(radarLabel({ checkedAt: '2026-10-02T00:00:00Z', status: 'error', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 1 })).toMatchObject({ text: 'Check failed', tone: 'danger' })
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

describe('radarStateMeta', () => {
  it('reads an unknown or unrecognised state as not checked, never as a pass', () => {
    expect(radarStateMeta('unknown')).toEqual({ label: 'Not checked', tone: 'neutral' })
    expect(radarStateMeta('weird')).toEqual({ label: 'Not checked', tone: 'neutral' })
    expect(radarStateMeta('ok').label).toBe('Nothing found')
  })

  it('labels a radar run with nothing declared as nothing to check', () => {
    expect(radarLabel({ checkedAt: '2026-10-02T00:00:00Z', status: 'nothing_to_check', open: { error: 0, warn: 0, info: 0 }, unchecked: 6, errored: 0 }).text).toBe('Nothing to check yet')
  })

  it('a column the server could not read never reads as $0, "Not set", "None yet" or a pass', () => {
    const unread = card({
      spend: { llmUsd30d: null, llmCalls30d: null, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: false },
      unreadable: ['gate_runs', 'reports', 'sdk', 'spend', 'caps', 'releases', 'kind'],
      openReports: 3,
      radar: { checkedAt: '2026-10-02T00:00:00Z', status: 'pass', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
    })
    expect(spendText(unread)).toBe('Could not read')
    expect(budgetText(unread)).toBe('Could not read')
    expect(releaseText(unread)).toBe('Could not read')
    expect(openReportsText(unread)).toBe('3+')
    expect(kindLabel(unread)).toBe('Kind: could not read')
    expect(sdkLabel(unread.sdk, unread.unreadable).text).toBe('SDK: could not read')
    expect(radarLabel(unread.radar, unread.unreadable).tone).not.toBe('okSubtle')

    const read = card({ spend: { llmUsd30d: 1.5, llmCalls30d: 3, partial: true, autofixCapUsd: 2, monthlyLlmBudgetUsd: null, capsKnown: true } })
    expect(spendText(read)).toBe('at least $1.50')
    expect(budgetText(read)).toBe('Not set')
    expect(releaseText(read)).toBe('None yet')
    expect(openReportsText(read)).toBe('0')
  })
})
