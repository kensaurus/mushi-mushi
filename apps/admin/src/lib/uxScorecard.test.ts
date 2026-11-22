import { describe, expect, it } from 'vitest'
import { crossCuttingCauses, deltaLabel, reportForCause, runMean, scoreTone, type UxScorecardCause } from './uxScorecard'

const cause = (patternKey: string, kind: UxScorecardCause['kind']): UxScorecardCause => ({
  patternKey,
  kind,
  dimension: 'copy',
  severity: 'medium',
  title: patternKey,
  problem: 'p',
  fix: 'f',
  pages: [],
  confidence: 0.8,
  evidenceSeen: true,
})

describe('uxScorecard', () => {
  it('tones a score by what it means for the user', () => {
    expect(scoreTone(3)).toBe('dangerSubtle')
    expect(scoreTone(4)).toBe('dangerSubtle')
    expect(scoreTone(5)).toBe('warnSubtle')
    expect(scoreTone(7)).toBe('okSubtle')
  })

  it('labels a change since the last run, and says nothing for none', () => {
    expect(deltaLabel(2)).toBe('+2')
    expect(deltaLabel(-1)).toBe('−1')
    expect(deltaLabel(0)).toBeNull()
    expect(deltaLabel(null)).toBeNull()
  })

  it('keeps causes across pages and contradictions, and finds the report a cause was filed as', () => {
    const causes = [cause('ux:copy:a', 'shared'), cause('ux:copy:b', 'page'), cause('ux:truthfulness:c', 'contradiction')]
    expect(crossCuttingCauses(causes).map((c) => c.patternKey)).toEqual(['ux:copy:a', 'ux:truthfulness:c'])
    const reports = [{ id: 'r1', title: 't', status: 'new', severity: 'medium', pattern_key: 'ux:copy:a', created_at: '' }]
    expect(reportForCause(causes[0], reports)?.id).toBe('r1')
    expect(reportForCause(causes[1], reports)).toBeNull()
  })

  it('reads the average from the run counts, else from the rows', () => {
    expect(runMean({ run: { counts: { mean: 5.4 } } as never, rows: [] })).toBe(5.4)
    expect(runMean({ run: { counts: {} } as never, rows: [{ overall: 4 }, { overall: 7 }] as never })).toBe(5.5)
    expect(runMean({ run: null, rows: [] })).toBeNull()
  })
})
