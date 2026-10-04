/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/TesterSubmissionCard.test.tsx
 * PURPOSE: Group K entries 62, 217 and 315 — Spam (−10 reputation) asks first,
 *          a spam-marked submission can still be re-graded, and the card is
 *          the only place that toasts a grade.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error, info: vi.fn(), warn: vi.fn() }),
}))

import { TesterSubmissionCard, reviewActionsFor } from './TesterSubmissionCard'

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

describe('reviewActionsFor', () => {
  it('offers every grade while pending, none once graded, and an override for spam', () => {
    expect(reviewActionsFor('pending')).toEqual(['accept', 'informative', 'duplicate', 'spam'])
    expect(reviewActionsFor('accepted')).toEqual([])
    expect(reviewActionsFor('spam')).toEqual(['accept', 'informative', 'duplicate'])
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
