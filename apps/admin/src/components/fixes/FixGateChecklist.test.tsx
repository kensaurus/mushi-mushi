/**
 * @vitest-environment jsdom
 *
 * Merge checks on a fix (Plan 024, ADR 0035): every gate status in words
 * with a glyph, the detail only when a gate has not passed, the automatic
 * merge state, regressions with the revert PR link, "Not checked yet" when
 * there is no verification, and "Re-check" (including the hourly limit).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixVerification } from '../../lib/verifyTypes'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))

import { FixGateChecklist } from './FixGateChecklist'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VERIFICATION: FixVerification = {
  headSha: 'abcdef1234567890',
  passed: false,
  secondJudge: null,
  gates: [
    { id: 'review', status: 'pass', label: 'Opus review: merge', detail: 'Nothing to do.' },
    { id: 'ci', status: 'fail', label: 'CI is green', detail: 'Fix the failing check "test" and push.' },
    {
      id: 'fail_to_pass',
      status: 'not_set_up',
      label: 'Test proves the fix',
      detail: 'Add the Mushi verify workflow in Settings.',
    },
    { id: 'protected', status: 'pending', label: 'No tests weakened', detail: 'Waiting for the diff.' },
    { id: 'budget', status: 'pass', label: 'Small change (2 files, 48 lines)', detail: '' },
    {
      id: 'second_review',
      status: 'unavailable',
      label: 'Second review',
      detail: 'Add an OpenAI or OpenRouter key.',
    },
  ],
  autoMerge: { state: 'skipped', detail: 'Automatic merge is off for this app.' },
  regressions: [
    {
      id: 'r1',
      signal: 'report_reopened',
      detail: 'Reopened by the reporter.',
      revertState: 'pr_opened',
      revertPrUrl: 'https://github.com/a/b/pull/9',
      createdAt: null,
    },
  ],
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.apiFetch.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(FixGateChecklist, { fixId: 'fix-1' }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

function recheckButton(): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Re-check')) as HTMLButtonElement
}

describe('FixGateChecklist', () => {
  it('reads the verification from the timeline and shows every gate in words', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { events: [], verification: VERIFICATION } })
    await render()
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1)
    expect(mocks.apiFetch.mock.calls[0]![0]).toBe('/v1/admin/fixes/fix-1/timeline')

    expect(q('fix-gate-summary')!.textContent).toBe('2 of 6 checks passed on commit abcdef1')
    expect(q('fix-gate-review')!.textContent).toContain('Passed')
    expect(q('fix-gate-review')!.textContent).toContain('Opus review: merge')
    expect(q('fix-gate-review')!.textContent).not.toContain('Nothing to do.')
    expect(q('fix-gate-ci')!.textContent).toContain('Failed')
    expect(q('fix-gate-ci')!.textContent).toContain('Fix the failing check "test" and push.')
    expect(q('fix-gate-fail_to_pass')!.textContent).toContain('Not set up')
    expect(q('fix-gate-protected')!.textContent).toContain('Waiting')
    expect(q('fix-gate-second_review')!.textContent).toContain('Unavailable')
    expect(q('fix-gate-second_review')!.textContent).toContain('Add an OpenAI or OpenRouter key.')
    // Each status carries a glyph next to its word (never colour alone).
    for (const id of ['review', 'ci', 'fail_to_pass', 'protected', 'second_review']) {
      expect(q(`fix-gate-${id}`)!.querySelector('[aria-hidden="true"]')!.textContent!.trim().length).toBe(1)
    }

    expect(q('fix-gate-auto-merge')!.textContent).toContain('Not merged')
    expect(q('fix-gate-auto-merge')!.textContent).toContain('Automatic merge is off for this app.')
    const regressions = q('fix-gate-regressions')!
    expect(regressions.textContent).toContain('The bug report was reopened')
    expect(regressions.textContent).toContain('Mushi opened a revert PR')
    expect(regressions.querySelector('a')!.getAttribute('href')).toBe('https://github.com/a/b/pull/9')
  })

  it('says "Not checked yet" when the timeline has no verification and the route answers 404', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith('/timeline')
        ? { ok: true, data: { events: [] } }
        : { ok: false, error: { code: 'NOT_FOUND', message: 'No verification' } },
    )
    await render()
    expect(mocks.apiFetch.mock.calls.map((c) => c[0])).toEqual([
      '/v1/admin/fixes/fix-1/timeline',
      '/v1/admin/fixes/fix-1/verification',
    ])
    expect(q('fix-gate-unchecked')!.textContent).toContain('Not checked yet')
    expect(host.textContent).not.toContain('could not load')
  })

  it('treats a null verification on the timeline as not checked', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { events: [], verification: null } })
    await render()
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1)
    expect(q('fix-gate-unchecked')).not.toBeNull()
  })

  it('re-checks through POST /verify and shows the fresh gates', async () => {
    mocks.apiFetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          data: {
            ...VERIFICATION,
            gates: VERIFICATION.gates.map((g) => ({ ...g, status: 'pass' })),
            passed: true,
            autoMerge: { state: 'merged', detail: null },
            regressions: [],
          },
        }
      }
      return path.endsWith('/timeline') ? { ok: true, data: { verification: VERIFICATION } } : { ok: false }
    })
    await render()
    await act(async () => {
      recheckButton().click()
    })
    const post = mocks.apiFetch.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')
    expect(post?.[0]).toBe('/v1/admin/fixes/fix-1/verify')
    expect(q('fix-gate-summary')!.textContent).toContain('All 6 checks passed')
    expect(q('fix-gate-auto-merge')!.textContent).toContain('Merged by Mushi')
    expect(q('fix-gate-regressions')).toBeNull()
    expect(q('fix-gate-notice')!.textContent).toContain('Checked again just now.')
  })

  it('explains the hourly limit politely on 429 and keeps the last result', async () => {
    mocks.apiFetch.mockImplementation(async (_path: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }
        : { ok: true, data: { verification: VERIFICATION } },
    )
    await render()
    await act(async () => {
      recheckButton().click()
    })
    expect(q('fix-gate-notice')!.textContent).toContain('re-checked this fix 6 times in the last hour')
    expect(q('fix-gate-notice')!.textContent).not.toContain('Too many requests')
    expect(q('fix-gate-ci')).not.toBeNull()
  })
})
