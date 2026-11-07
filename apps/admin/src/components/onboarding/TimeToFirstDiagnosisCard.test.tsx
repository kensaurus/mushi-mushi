/**
 * @vitest-environment jsdom
 *
 * Report 9b7624e6: the Set up "Test it" card stayed on "Waiting…" after the
 * test report it asked for was diagnosed. The route already returns
 * testDiagnosisAt; the card has to render that and refetch when it arrives.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  data: {
    keyMintedAt: null as string | null,
    firstDiagnosisAt: null as string | null,
    ms: null as number | null,
    testDiagnosisAt: null as string | null,
  },
  reload: vi.fn(),
  invalidateApiCache: vi.fn(),
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: state.data,
    loading: false,
    error: null,
    isValidating: false,
    reload: state.reload,
    lastFetchedAt: null,
  }),
}))

vi.mock('../../lib/supabase', () => ({
  invalidateApiCache: state.invalidateApiCache,
}))

import { TimeToFirstDiagnosisCard } from './TimeToFirstDiagnosisCard'
import { invalidateTimeToFirstDiagnosis } from '../../lib/useTimeToFirstDiagnosis'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function render(hasApiKey = true) {
  act(() => {
    root.render(
      createElement(TimeToFirstDiagnosisCard, {
        projectId: 'p1',
        hasApiKey,
        onOpenSdk: vi.fn(),
      }),
    )
  })
}

beforeEach(() => {
  state.data = { keyMintedAt: null, firstDiagnosisAt: null, ms: null, testDiagnosisAt: null }
  state.reload.mockClear()
  state.invalidateApiCache.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('TimeToFirstDiagnosisCard', () => {
  it('shows the diagnosed test bug instead of Waiting once testDiagnosisAt is set', () => {
    state.data = {
      keyMintedAt: '2026-10-30T00:00:00Z',
      firstDiagnosisAt: null,
      ms: null,
      testDiagnosisAt: '2026-10-30T00:01:00Z',
    }
    render()
    expect(host.textContent).toContain('Your test bug got its plain-English read')
    expect(host.textContent).not.toContain('Waiting on the first report')
    expect(host.querySelector('[data-testid="ttfd-test-only"]')).not.toBeNull()
  })

  it('leaves Waiting when the test report is diagnosed after the card has loaded', () => {
    render()
    expect(host.textContent).toContain('Waiting on the first report from your app.')
    expect(state.reload).not.toHaveBeenCalled()
    act(() => {
      state.data = {
        keyMintedAt: '2026-10-30T00:00:00Z',
        firstDiagnosisAt: null,
        ms: null,
        testDiagnosisAt: '2026-10-30T00:01:00Z',
      }
      invalidateTimeToFirstDiagnosis()
    })
    expect(state.reload).toHaveBeenCalled()
    expect(host.textContent).toContain('Your test bug got its plain-English read')
    expect(host.textContent).not.toContain('Waiting on the first report')
  })

  it('a report from the app shows the clock, not the test-only note', () => {
    state.data = {
      keyMintedAt: '2026-10-30T00:00:00Z',
      firstDiagnosisAt: '2026-10-30T00:02:00Z',
      ms: 120_000,
      testDiagnosisAt: '2026-10-30T00:01:00Z',
    }
    render()
    expect(host.textContent).toContain('2m')
    expect(host.textContent).not.toContain('Your test bug got its plain-English read')
    expect(host.textContent).not.toContain('Waiting on the first report')
  })
})
