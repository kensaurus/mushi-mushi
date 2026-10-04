import { describe, expect, it, vi } from 'vitest'

vi.mock('./mode', () => ({ useAdminMode: () => ({ isQuickstart: true, isBeginner: false, isAdvanced: false }) }))

import { parseVariantWeight, resolveQuickExperimentsRedirect } from './experimentsModeUx'
import { EMPTY_EXPERIMENTS_STATS } from '../components/experiments/ExperimentsStatsTypes'

const withOne = { ...EMPTY_EXPERIMENTS_STATS, hasAnyProject: true, totalExperiments: 1, topPriority: 'healthy' as const }

describe('resolveQuickExperimentsRedirect', () => {
  it('sends a first visit to the list once an experiment exists', () => {
    expect(resolveQuickExperimentsRedirect(withOne, null)).toBe('experiments')
  })

  it('lets a quickstart user open the New form for a second experiment', () => {
    expect(resolveQuickExperimentsRedirect(withOne, 'new')).toBeNull()
    expect(resolveQuickExperimentsRedirect(withOne, 'experiments')).toBeNull()
  })

  it('still lands an empty project on the New form', () => {
    expect(
      resolveQuickExperimentsRedirect({ ...EMPTY_EXPERIMENTS_STATS, hasAnyProject: true, topPriority: 'no_experiments' }, null),
    ).toBe('new')
  })
})

describe('parseVariantWeight', () => {
  it('accepts 0–1 and rejects blanks, NaN and out-of-range values', () => {
    expect(parseVariantWeight('0.5')).toBe(0.5)
    expect(parseVariantWeight('0')).toBe(0)
    expect(parseVariantWeight('')).toBeNull()
    expect(parseVariantWeight('abc')).toBeNull()
    expect(parseVariantWeight('1.5')).toBeNull()
  })
})
