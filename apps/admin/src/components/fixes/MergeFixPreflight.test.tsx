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
    await act(async () => button('Merge anyway').click())
    expect(mergeBody()).toEqual({ mergeMethod: 'squash', override: true })
    expect(onMerged).toHaveBeenCalledWith('fixed')
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

  it('re-runs the review on request', async () => {
    respond(HOLD)
    await open()
    mocks.apiFetch.mockImplementationOnce(async () => ({ ok: true, data: { review: { ...NOT_REVIEWED, state: 'queued', label: 'Review in progress' } } }))
    await act(async () => button('Re-run review').click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/fixes/fix-1/review', { method: 'POST' })
    expect(document.body.textContent).toContain('Review in progress')
  })
})
