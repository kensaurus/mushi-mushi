/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/TesterSubmissionCard.test.tsx
 * PURPOSE: Group K entries 62, 217 and 315 — Spam (−10 reputation) asks first,
 *          a spam-marked submission can still be re-graded, and the card is
 *          the only place that toasts a grade. Group B item 234 — every status
 *          the database allows renders (`triaged` and `withdrawn` crashed it).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error, info: vi.fn(), warn: vi.fn() }),
}))

import { TesterSubmissionCard } from './TesterSubmissionCard'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.apiFetch.mockReset()
  mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
  mocks.success.mockReset()
  mocks.error.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

function buttons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'))
}

function button(label: RegExp): HTMLButtonElement {
  const b = buttons().find((el) => label.test(el.textContent ?? ''))
  if (!b) throw new Error(`no button ${label}`)
  return b
}

async function render(status: 'pending' | 'spam' | 'accepted', onReviewed = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(TesterSubmissionCard, {
        submission: { id: 's-1', status, points_awarded: 0, tester_handle: 'ada', app_name: 'Demo', reviewer_note: null },
        onReviewed,
      }),
    )
  })
  return onReviewed
}

function gradeLabels(): string[] {
  return buttons()
    .map((b) => b.textContent ?? '')
    .filter((t) => /Accept|Informative|Duplicate|Spam/.test(t))
}

describe('grade buttons by status', () => {
  it('offers every grade while pending, an override for spam, and none once graded', async () => {
    await render('pending')
    expect(gradeLabels()).toHaveLength(4)
    await render('spam')
    expect(gradeLabels().some((t) => /Spam/.test(t))).toBe(false)
    expect(gradeLabels()).toHaveLength(3)
    await render('accepted')
    expect(gradeLabels()).toHaveLength(0)
  })
})

describe('TesterSubmissionCard', () => {
  it('asks before marking spam and only posts after confirming', async () => {
    const onReviewed = await render('pending')
    await act(async () => button(/Spam/).click())
    expect(mocks.apiFetch).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('loses 10 reputation')

    await act(async () => button(/^Mark as spam$/).click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/tester-submissions/s-1/spam', expect.objectContaining({ method: 'POST' }))
    expect(onReviewed).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledTimes(1)
  })

  it('cancelling the spam dialog sends nothing', async () => {
    await render('pending')
    await act(async () => button(/Spam/).click())
    await act(async () => button(/^Cancel$/).click())
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })

  it('grades other actions straight away', async () => {
    await render('pending')
    await act(async () => button(/Accept/).click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/tester-submissions/s-1/accept', expect.anything())
  })

  it('lets a reviewer override a spam-marked submission', async () => {
    await render('spam')
    expect(buttons().some((b) => /Accept/.test(b.textContent ?? ''))).toBe(true)
    expect(buttons().some((b) => /Spam/.test(b.textContent ?? ''))).toBe(false)
  })

  it('shows plain English for a raw server slug', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: false, error: { code: 'ERROR', message: 'submission_not_found' } })
    await render('pending')
    await act(async () => button(/Accept/).click())
    expect(mocks.error).toHaveBeenCalledWith(expect.not.stringContaining('submission_not_found'))
  })
})

// tester_submissions CHECK (migration 20260523002000_tester_submissions_and_subscriptions.sql).
const DB_STATUSES = ['pending', 'triaged', 'accepted', 'informative', 'duplicate', 'spam', 'withdrawn'] as const

describe('every database status (group B 234)', () => {
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

  it('names the withdrawn state', async () => {
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
