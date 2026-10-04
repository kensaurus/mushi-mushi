/**
 * FILE: apps/admin/src/components/dlq/queueRetry.test.ts
 * PURPOSE: Retry is offered only where the API allows it (QA bug 55), and
 *          lane links open the lane they name (bug 204).
 */

import { describe, expect, it } from 'vitest'
import { isQueueItemRetryable, parseQueueLaneParam } from './queueRetry'

const now = Date.parse('2026-10-04T12:00:00Z')
const ago = (min: number) => new Date(now - min * 60_000).toISOString()
const item = (status: string, extra: Record<string, string | null> = {}) => ({ status, created_at: ago(1), ...extra })

describe('isQueueItemRetryable', () => {
  it('offers retry on failed and dead-letter jobs', () => {
    expect(isQueueItemRetryable(item('failed'), now)).toBe(true)
    expect(isQueueItemRetryable(item('dead_letter'), now)).toBe(true)
  })

  it('never offers retry on completed jobs', () => {
    expect(isQueueItemRetryable(item('completed', { created_at: ago(600) }), now)).toBe(false)
  })

  it('offers retry on pending/running jobs only once stuck', () => {
    expect(isQueueItemRetryable(item('running', { started_at: ago(2) }), now)).toBe(false)
    expect(isQueueItemRetryable(item('running', { started_at: ago(20) }), now)).toBe(true)
    expect(isQueueItemRetryable(item('pending', { scheduled_at: ago(2) }), now)).toBe(false)
    expect(isQueueItemRetryable(item('pending', { scheduled_at: null, created_at: ago(30) }), now)).toBe(true)
  })
})

describe('parseQueueLaneParam', () => {
  it('reads ?status= and the older ?filter=', () => {
    expect(parseQueueLaneParam(new URLSearchParams('status=dead_letter'))).toBe('dead_letter')
    expect(parseQueueLaneParam(new URLSearchParams('tab=items&filter=failed'))).toBe('failed')
  })

  it('maps stalled to the pending lane and ignores junk', () => {
    expect(parseQueueLaneParam(new URLSearchParams('status=stalled'))).toBe('pending')
    expect(parseQueueLaneParam(new URLSearchParams('status=nope'))).toBeNull()
    expect(parseQueueLaneParam(new URLSearchParams(''))).toBeNull()
  })
})
