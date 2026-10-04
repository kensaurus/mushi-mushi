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
import type { QueueItem } from './types'

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
    root.render(createElement(MemoryRouter, null, createElement(QueueItemCard, { item, retrying: false, onRetry: () => {} }))),
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
})
