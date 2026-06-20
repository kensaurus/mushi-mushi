import { describe, expect, it } from 'vitest'
import { postureBudgetForMode, POSTURE_PRIORITY } from '../components/PagePosture'

describe('PagePosture', () => {
  it('caps rows by admin mode', () => {
    expect(postureBudgetForMode('quickstart')).toBe(2)
    expect(postureBudgetForMode('beginner')).toBe(2)
    expect(postureBudgetForMode('advanced')).toBe(3)
  })

  it('orders posture priorities for stable slot sorting', () => {
    expect(POSTURE_PRIORITY.status).toBeLessThan(POSTURE_PRIORITY.recommended)
    expect(POSTURE_PRIORITY.recommended).toBeLessThan(POSTURE_PRIORITY.heroOrSnapshot)
    expect(POSTURE_PRIORITY.heroOrSnapshot).toBeLessThan(POSTURE_PRIORITY.guide)
  })
})
