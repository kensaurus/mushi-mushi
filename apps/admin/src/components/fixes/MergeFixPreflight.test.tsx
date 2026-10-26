/**
 * @vitest-environment jsdom
 *
 * Merge popover with the Opus review of a cloud agent's PR (ADR 0030):
 * a hold disables the merge until "Merge anyway" is ticked, and then sends
 * override: true; fix-first findings show before merging; a PR with no review
 * says "Not reviewed" and merges as before.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixReview } from '../../lib/fixReview'

const NOT_REVIEWED: FixReview = {
  state: 'not_reviewed',
  label: 'Not reviewed',
  verdict: null,
  fixesReport: null,
  risk: null,
  findings: [],
  scopeCreep: null,
  removesBehavior: [],
  needsHumanDecision: null,
  summary: null,
  rulesApplied: [],
  reason: null,
  headSha: null,
  diffTruncated: false,
  model: null,
  costUsd: null,
  commentUrl: null,
  reviewedAt: null,
}

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('./FixCiFeedback', () => ({ FixCiFeedback: () => null }))

import { MergeFixPreflight } from './MergeFixPreflight'

const HOLD: FixReview = {
  ...NOT_REVIEWED,
  state: 'hold',
  label: 'Opus review: hold',
  verdict: 'hold',
  fixesReport: true,
  risk: 'high',
  findings: [
    { severity: 'blocker', file: 'src/lesson/Resume.tsx', line: 40, issue: 'Deletes the resume-lesson flow.', suggested_fix: 'Keep ResumeBanner.' },
  ],
  removesBehavior: ['Resume where you left off'],
  summary: 'Fixes the crash but removes the resume feature.',
}

const button = (text: string) => {
  const b = Array.from(document.body.querySelectorAll('button')).find((x) => x.textContent?.trim().startsWith(text))
  if (!b) throw new Error(`no button "${text}"`)
  return b as HTMLButtonElement
}

function respond(review: FixReview, merge: { ok: boolean; error?: { code: string; message: string } } = { ok: true }) {
  mocks.apiFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/timeline')) return { ok: true, data: { review } }
    if (url.endsWith('/merge')) return merge.ok ? { ok: true, data: { reportStatus: 'fixed' } } : { ok: false, error: merge.error }
    return { ok: true, data: {} }
  })
}

const mergeBody = () => {
  const call = mocks.apiFetch.mock.calls.find(([url]) => String(url).endsWith('/merge'))
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null
}

describe('MergeFixPreflight — Opus review gate', () => {
  let container: HTMLDivElement
  let root: Root
  const onMerged = vi.fn()

  async function open() {
    await act(async () =>
      root.render(createElement(MergeFixPreflight, { fixId: 'fix-1', prUrl: 'https://github.com/a/b/pull/1', prNumber: 1, onMerged })),
    )
    await act(async () => button('Merge PR in console').click())
  }

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    onMerged.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('keeps merge checks at h4 on the report page', async () => {
    respond(NOT_REVIEWED)
    await open()
    const heading = document.querySelector('[data-testid="fix-gate-checklist"] :is(h3, h4)')
    expect(heading?.tagName).toBe('H4')
    expect(heading?.textContent).toBe('Merge checks')
  })

  it('a hold shows its findings and blocks the merge until "Merge anyway" is ticked', async () => {
    respond(HOLD)
    await open()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Opus review: hold')
    expect(text).toContain('Deletes the resume-lesson flow.')
    expect(text).toContain('Resume where you left off')
    expect(button('Squash merge').disabled).toBe(true)

    const box = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => box.click())
    // A reason is required before the override can be sent.
    expect(button('Merge anyway').disabled).toBe(true)
    const reason = document.body.querySelector('input[type="text"], input:not([type])') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(reason, 'Checked the resume flow by hand')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Merge anyway').click())
    expect(mergeBody()).toEqual({ mergeMethod: 'squash', override: true, overrideReason: 'Checked the resume flow by hand' })
    expect(onMerged).toHaveBeenCalledWith('fixed')
  })

  it('shows the merge checks for the PR head from the same timeline read', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) =>
      url.endsWith('/timeline')
        ? {
            ok: true,
            data: {
              review: HOLD,
              verification: {
                headSha: 'abc1234def',
                passed: false,
                secondJudge: null,
                gates: [{ id: 'fail_to_pass', status: 'not_set_up', label: 'Test proves the fix', detail: 'Add the workflow.' }],
                autoMerge: { state: 'none', detail: null },
                regressions: [],
              },
            },
          }
        : { ok: true, data: {} },
    )
    await open()
    const checks = document.body.querySelector('[data-testid="fix-gate-checklist"]')!
    expect(checks.textContent).toContain('Not set up')
    expect(checks.textContent).toContain('Test proves the fix')
    expect(mocks.apiFetch.mock.calls.some(([url]) => String(url).endsWith('/verification'))).toBe(false)
  })

  it('a hold on an older commit, or while a re-review runs, still needs the override', async () => {
    respond({ ...HOLD, state: 'stale', stale: true, rerunning: true, label: 'Opus review: hold (older commit) · re-review in progress' })
    await open()
    expect(document.body.textContent).toContain('This verdict is about an older commit')
    expect(button('Squash merge').disabled).toBe(true)
    expect(document.body.querySelector('input[type="checkbox"]')).not.toBeNull()
  })

  it('an unreviewed PR says "Not reviewed" and merges without an override', async () => {
    respond(NOT_REVIEWED)
    await open()
    expect(document.body.textContent).toContain('Not reviewed')
    expect(button('Squash merge').disabled).toBe(false)
    await act(async () => button('Squash merge').click())
    expect(mergeBody()).toEqual({ mergeMethod: 'squash' })
  })

  it('a fix-first review lists its findings and still merges', async () => {
    respond({ ...HOLD, state: 'fix_first', label: 'Opus review: fix first', verdict: 'fix_first', findings: [{ ...HOLD.findings[0], severity: 'major' }] })
    await open()
    expect(document.body.textContent).toContain('Major')
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull()
    expect(button('Squash merge').disabled).toBe(false)
  })

  it('while the first review runs, says so and sends the confirmation with the click', async () => {
    respond({ ...NOT_REVIEWED, state: 'queued', label: 'Review in progress' })
    await open()
    expect(document.body.textContent).toContain('The Opus review is still running. Merging now skips it')
    await act(async () => button('Squash merge').click())
    expect(mergeBody()).toEqual({ mergeMethod: 'squash', confirmPendingReview: true })
  })

  it('re-runs the review on request, and offers no second run while one is going', async () => {
    respond(HOLD)
    await open()
    mocks.apiFetch.mockImplementationOnce(async () => ({ ok: true, data: { review: { ...NOT_REVIEWED, state: 'queued', label: 'Review in progress' } } }))
    await act(async () => button('Re-run review').click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/fixes/fix-1/review', { method: 'POST' })
    expect(document.body.textContent).toContain('Review in progress')
    expect([...document.body.querySelectorAll('button')].some((b) => b.textContent?.includes('Re-run review'))).toBe(false)
  })
})
