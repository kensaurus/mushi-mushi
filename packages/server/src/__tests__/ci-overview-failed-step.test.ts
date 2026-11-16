/**
 * FILE: ci-overview-failed-step.test.ts
 * PURPOSE: The overview names the first step that failed (2026-11-16), so the console can say
 *          "Lint & Build failed at Dead code (production)" instead of only the job name.
 */
import { describe, expect, it } from 'vitest'
import { firstFailedStep } from '../../supabase/functions/_shared/ci-overview.ts'

describe('firstFailedStep', () => {
  it('returns the first failing step, trimmed', () => {
    expect(
      firstFailedStep([
        { name: 'Set up job', conclusion: 'success', seconds: 2 },
        { name: ' Dead code (production) ', conclusion: 'failure', seconds: 40 },
        { name: 'Unit tests', conclusion: 'failure', seconds: 90 },
      ]),
    ).toBe('Dead code (production)')
  })

  it('is null when nothing failed, the steps were not read, or a step has no name', () => {
    expect(firstFailedStep([{ name: 'Build', conclusion: 'success', seconds: 1 }])).toBeNull()
    expect(firstFailedStep(null)).toBeNull()
    expect(firstFailedStep([{ name: '  ', conclusion: 'failure', seconds: 1 }])).toBeNull()
  })
})
