/**
 * The tab title, the In flight card and the snapshot share one count.
 * A pending or dispatched attempt, and a queued dispatch with no attempt
 * yet, are in flight. One report counts once.
 */

import { describe, expect, it } from 'vitest'
import { collectInFlightReportIds, inFlightHeadline, isLiveFixAttempt } from './countDefinitions'

describe('in-flight headline', () => {
  it('counts pending and dispatched attempts, not a finished one', () => {
    expect(isLiveFixAttempt('pending')).toBe(true)
    expect(isLiveFixAttempt('Dispatched')).toBe(true)
    expect(isLiveFixAttempt('failed')).toBe(false)
    const ids = collectInFlightReportIds(
      [
        { report_id: 'pending', status: 'pending' },
        { report_id: 'dispatched', status: 'dispatched' },
        { report_id: 'done', status: 'failed' },
      ],
      [],
    )
    expect([...ids].sort()).toEqual(['dispatched', 'pending'])
  })

  it('keeps a live attempt on an already-resolved report', () => {
    const ids = collectInFlightReportIds([{ report_id: 'fixed', status: 'running' }], [])
    expect(ids.has('fixed')).toBe(true)
  })

  it('counts a queued dispatch once, even beside a live attempt on the same report', () => {
    const ids = collectInFlightReportIds(
      [{ report_id: 'r1', status: 'running' }],
      [
        { report_id: 'r1', status: 'queued' },
        { report_id: 'r2', status: 'running' },
        { report_id: 'r3', status: 'failed' },
      ],
    )
    expect([...ids].sort()).toEqual(['r1', 'r2'])
  })

  it('never goes below the server total when the loaded list is short', () => {
    expect(inFlightHeadline(0, 1, 0)).toBe(1)
    expect(inFlightHeadline(2, 1)).toBe(2)
    expect(inFlightHeadline(1, undefined, null)).toBe(1)
  })
})
