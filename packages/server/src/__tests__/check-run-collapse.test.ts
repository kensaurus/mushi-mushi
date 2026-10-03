import { describe, expect, it } from 'vitest'
import { collapseCheckRuns, isAdvisoryCheckRun } from '../../supabase/functions/_shared/github.ts'

describe('collapseCheckRuns', () => {
  it('ignores the Copilot review run when the CI jobs passed', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' },
      { name: 'gate', status: 'completed', conclusion: 'success' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('does not wait on a pending Copilot review', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'in_progress', conclusion: null },
      { name: 'gate', status: 'completed', conclusion: 'success' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('keeps a real CI failure red', () => {
    expect(collapseCheckRuns([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'failure' },
    ])).toEqual({ status: 'completed', conclusion: 'failure' })
  })

  it('stays pending while any CI job runs', () => {
    expect(collapseCheckRuns([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'queued', conclusion: null },
    ])).toEqual({ status: 'in_progress', conclusion: null })
  })

  it('reports nothing when only the review run exists', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' },
    ])).toEqual({ status: null, conclusion: null })
  })
})

describe('isAdvisoryCheckRun', () => {
  it('matches only review runs', () => {
    expect(isAdvisoryCheckRun({ name: 'copilot-pull-request-reviewer' })).toBe(true)
    expect(isAdvisoryCheckRun({ name: 'gate' })).toBe(false)
    expect(isAdvisoryCheckRun({})).toBe(false)
  })
})
