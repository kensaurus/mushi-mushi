import { describe, expect, it } from 'vitest'
import { costLogQuery } from './CostRawLogTable'

describe('costLogQuery', () => {
  const base = { projectId: 'p1', page: 1, limit: 25, sort: 'occurred_at', order: 'desc', q: '' }

  it('asks for failed calls in the last 24h when the banner link is followed', () => {
    const qs = new URLSearchParams(
      costLogQuery({ ...base, failedOnly: true, since: '24h', now: Date.parse('2026-10-04T12:00:30Z') }),
    )
    expect(qs.get('status')).toBe('failed')
    expect(qs.get('since')).toBe('2026-10-03T12:00:00.000Z')
  })

  it('sends neither filter by default', () => {
    const qs = new URLSearchParams(costLogQuery({ ...base, failedOnly: false, since: null }))
    expect(qs.has('status')).toBe(false)
    expect(qs.has('since')).toBe(false)
  })
})
