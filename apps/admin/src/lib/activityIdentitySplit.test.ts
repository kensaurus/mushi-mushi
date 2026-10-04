import { describe, expect, it } from 'vitest'
import { identitySplit } from './activityIdentitySplit'

describe('identitySplit (QA 289)', () => {
  it('counts people when the server sends them', () => {
    // One signed-in user with 40 sessions and 2 anonymous devices.
    const s = identitySplit({ identified: 40, anonymous: 3, identified_people: 1, anonymous_devices: 2 })
    expect(s.unit).toBe('people')
    expect(s.identified).toBe(1)
    expect(s.anonymous).toBe(2)
    expect(s.identifiedLabel).toBe('Signed-in people')
    expect(s.identifiedPct).toBe(33)
  })

  it('labels the old payload as sessions instead of calling them people', () => {
    const s = identitySplit({ identified: 40, anonymous: 10 })
    expect(s.unit).toBe('sessions')
    expect(s.identifiedLabel).toBe('Signed-in sessions')
    expect(s.anonymousLabel).toBe('Anonymous sessions')
    expect(s.identifiedPct).toBe(80)
  })

  it('has no percentage when nobody visited', () => {
    expect(identitySplit({ identified: 0, anonymous: 0, identified_people: 0, anonymous_devices: 0 }).identifiedPct).toBeNull()
  })
})
