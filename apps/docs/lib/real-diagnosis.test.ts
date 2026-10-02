/**
 * The landing's real-diagnosis card quotes a model output a reader will judge
 * the product by, so its honesty markers are pinned: the provenance line says
 * the report is a sample and the diagnosis can be wrong, and every trim of the
 * model's answer is marked with an ellipsis.
 */
import { describe, expect, it } from 'vitest'
import { LANDING_REAL_DIAGNOSIS } from './landing-copy'

describe('landing real-diagnosis card', () => {
  it('says the report is a sample and the diagnosis can be wrong', () => {
    expect(LANDING_REAL_DIAGNOSIS.provenance).toMatch(/sample we wrote/i)
    expect(LANDING_REAL_DIAGNOSIS.provenance).toMatch(/can be wrong/i)
  })

  it('marks every trim with an ellipsis', () => {
    for (const field of [LANDING_REAL_DIAGNOSIS.report, LANDING_REAL_DIAGNOSIS.rootCause]) {
      expect(field).toContain('…')
    }
    // Both answers open with numbering ("(1)", "1. **XP display**:") that the
    // card drops, so each must start with an ellipsis.
    expect(LANDING_REAL_DIAGNOSIS.rootCause.startsWith('… ')).toBe(true)
    expect(LANDING_REAL_DIAGNOSIS.suggestedFix.startsWith('… ')).toBe(true)
  })
})
