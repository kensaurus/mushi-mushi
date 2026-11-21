/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/dlq/QueueItemCard.test.tsx
 * PURPOSE: Completed queue jobs never offer Retry (2026-10-04 console audit:
 *          the completed lane showed Retry on every finished job).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueueItemCard } from './QueueItemCard'
import { isQueueItemRetryable } from './queueRetry'
import { readableQueueError, waitedLabel, type QueueItem } from './types'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(status: string) {
  const item = {
    id: 'q1',
    report_id: 'r1',
    project_id: 'p1',
    stage: 'stage1',
    status,
    attempts: 1,
    max_attempts: 3,
    created_at: '2026-10-03T00:00:00Z',
  } as unknown as QueueItem
  act(() =>
    root.render(createElement(MemoryRouter, null, createElement(QueueItemCard, { item, retrying: false, canRetry: isQueueItemRetryable(item, Date.now()), onRetry: () => {} }))),
  )
  return [...host.querySelectorAll('button')].map((b) => b.textContent)
}

describe('QueueItemCard', () => {
  it('offers no Retry on a completed job', () => {
    expect(render('completed')).not.toContain('Retry')
  })

  it.each(['failed', 'dead_letter'])('offers Retry on a %s job', (status) => {
    expect(render(status)).toContain('Retry')
  })

  // Console audit 2026-11-21: rows read "stage1 · Pending", "Waiting 579h 57m"
  // and a raw `500 {"ok":false,…}` body.
  it('names the stage, gives the wait as an age, and lifts the message out of a JSON error', () => {
    const item = {
      id: 'q2',
      report_id: 'r2',
      project_id: 'p1',
      stage: 'stage1',
      status: 'pending',
      attempts: 1,
      max_attempts: 3,
      created_at: new Date(Date.now() - 24 * 86_400_000).toISOString(),
      completed_at: null,
      last_error: 'Stage 1 failed: 500 {"ok":false,"error":"Internal error. The failure was logged for investigation."}',
    } as unknown as QueueItem
    act(() =>
      root.render(createElement(MemoryRouter, null, createElement(QueueItemCard, { item, retrying: false, canRetry: false, onRetry: () => {} }))),
    )
    const text = host.textContent ?? ''
    expect(text).toContain('Fast filter · ')
    expect(text).not.toContain('stage1')
    expect(text).toContain('Waiting 24 d')
    expect(host.querySelector('[data-testid="queue-item-error"]')!.textContent).toBe(
      'Stage 1 failed: Internal error. The failure was logged for investigation.',
    )
  })
})

describe('readableQueueError', () => {
  it('keeps text that is not a status code plus JSON body', () => {
    expect(readableQueueError('fetch failed')).toEqual({ text: 'fetch failed', detail: null })
    expect(readableQueueError('Stage 1 failed: 500 {not json}')).toEqual({ text: 'Stage 1 failed: 500 {not json}', detail: null })
  })

  it('reads a nested error message', () => {
    expect(readableQueueError('502 {"error":{"message":"Upstream timed out"}}').text).toBe('Upstream timed out')
  })
})

describe('waitedLabel', () => {
  it.each([
    [5, '5 min'],
    [90, '2 h'],
    [47 * 60, '47 h'],
    [34_865, '24 d'],
  ])('%d minutes reads %s', (minutes, label) => {
    expect(waitedLabel(minutes)).toBe(label)
  })
})
