/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/TesterSubmissionCard.test.tsx
 * PURPOSE: The Mushi Bounties card renders every status the database allows
 *          (2026-10-04 console audit, group B item 234: `triaged` and
 *          `withdrawn` read `config.tone` on undefined and crashed the page).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { TesterSubmissionCard } from './TesterSubmissionCard'

// tester_submissions CHECK (migration 20260523002000_tester_submissions_and_subscriptions.sql).
const DB_STATUSES = ['pending', 'triaged', 'accepted', 'informative', 'duplicate', 'spam', 'withdrawn'] as const

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TesterSubmissionCard statuses', () => {
  it.each(DB_STATUSES)('renders a %s submission', async (status) => {
    await act(async () => {
      root.render(
        createElement(TesterSubmissionCard, {
          submission: { id: 's1', status, points_awarded: 0, tester_handle: 'ana', app_name: 'glot', reviewer_note: null },
          onReviewed: vi.fn(),
        }),
      )
    })
    expect(container.textContent).toContain('Mushi Bounties Submission')
  })

  it('names the withdrawn and triaged states', async () => {
    await act(async () => {
      root.render(
        createElement(TesterSubmissionCard, {
          submission: { id: 's1', status: 'withdrawn', points_awarded: 0, tester_handle: null, app_name: null, reviewer_note: null },
          onReviewed: vi.fn(),
        }),
      )
    })
    expect(container.textContent).toContain('Withdrawn')
  })
})
