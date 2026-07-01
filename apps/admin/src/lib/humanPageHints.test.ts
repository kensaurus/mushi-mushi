import { describe, expect, it } from 'vitest'
import {
  fixesFailedAction,
  fixesFailedHint,
  scopedHref,
  triageBacklogHint,
  driftCriticalHint,
  codeHealthErrorsHint,
  anomaliesNoMetricsHint,
} from './humanPageHints'

describe('humanPageHints', () => {
  it('scopes href with project', () => {
    expect(scopedHref('/fixes?status=failed', 'abc')).toBe('/fixes?status=failed&project=abc')
  })

  it('fixes failed copy', () => {
    expect(fixesFailedAction(2)).toBe('Review 2 failed fixes')
    expect(fixesFailedHint(1)).toMatch(/retry/i)
  })

  it('triage backlog hint', () => {
    expect(triageBacklogHint(3)).toMatch(/These reports/)
    expect(triageBacklogHint(1)).toMatch(/This report/)
  })

  it('drift critical hint', () => {
    expect(driftCriticalHint(2)).toMatch(/2 API mismatches/)
    expect(driftCriticalHint(1)).toMatch(/no longer agree/)
  })

  it('code health errors hint', () => {
    expect(codeHealthErrorsHint(3)).toMatch(/3 files/)
  })

  it('anomalies no metrics hint', () => {
    expect(anomaliesNoMetricsHint()).toMatch(/Send error rate/)
  })
})
