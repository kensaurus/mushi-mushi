import { describe, expect, it } from 'vitest'
import {
  fixesFailedAction,
  fixesFailedHint,
  scopedHref,
  triageBacklogHint,
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
})
