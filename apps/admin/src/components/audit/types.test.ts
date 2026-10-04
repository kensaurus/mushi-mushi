import { describe, expect, it } from 'vitest'
import { parseAuditOutcome, topActionLabel } from './types'
import { auditLinks } from '../../lib/statCardLinks'

describe('topActionLabel', () => {
  it('says when the count comes from a sample of a busier week', () => {
    expect(topActionLabel({ topAction7dCount: 412, topAction7dSampleSize: 1000, events7d: 5200 })).toBe(
      '412 occurrences in the latest 1,000 of 5,200 events this week',
    )
  })

  it('states a full count plainly', () => {
    expect(topActionLabel({ topAction7dCount: 1, topAction7dSampleSize: 7, events7d: 7 })).toBe(
      '1 occurrence this week, across your projects',
    )
  })
})

describe('audit failure links', () => {
  it('the Failures card opens the log filtered like its count', () => {
    expect(auditLinks.failures).toContain('outcome=failure')
    expect(auditLinks.failures).toContain('since=24h')
    expect(parseAuditOutcome('failure')).toBe('failure')
    expect(parseAuditOutcome('nope')).toBeNull()
  })
})
