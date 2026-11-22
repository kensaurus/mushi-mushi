/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/onboarding/TimeToFirstDiagnosisCard.test.tsx
 * PURPOSE: Report 9b7624e6. Verify stays on "Waiting on the first report…"
 *          until a diagnosed test report is actually fetched again.
 *
 * The card uses the real usePageData hook. apiFetch is the only stand-in.
 * The diagnosed payload is served only after the test-report POST returns, so
 * the waiting copy can leave only if that POST's invalidation fetches again.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TIME_TO_FIRST_DIAGNOSIS_PATH } from '../../lib/useTimeToFirstDiagnosis'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidateApiCache: vi.fn() }))

vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/activeProject', () => ({
  useActiveProjectSignal: () => 'p1',
  useProjectDataEpoch: () => 0,
}))
vi.mock('../../lib/activeOrg', () => ({ useActiveOrgSignal: () => 'o1' }))

import { TimeToFirstDiagnosisCard } from './TimeToFirstDiagnosisCard'
import { useSendTestReport } from '../../lib/useSendTestReport'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WAITING = {
  keyMintedAt: '2026-11-16T00:00:00.000Z',
  firstDiagnosisAt: null,
  ms: null,
  firstReportId: null,
  testDiagnosisAt: null,
}
const DIAGNOSED = {
  ...WAITING,
  testDiagnosisAt: '2026-11-16T00:01:00.000Z',
}

let diagnosisGets = 0
let phase: 'waiting' | 'diagnosed' = 'waiting'
let send: (projectId: string) => Promise<unknown> = async () => {}

function Harness() {
  send = useSendTestReport()
  return createElement(TimeToFirstDiagnosisCard, { hasApiKey: true, onOpenSdk: () => {} })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  diagnosisGets = 0
  phase = 'waiting'
  api.apiFetch.mockReset()
  api.invalidateApiCache.mockReset()
  api.apiFetch.mockImplementation(async (path: string) => {
    if (path === TIME_TO_FIRST_DIAGNOSIS_PATH) {
      diagnosisGets += 1
      return { ok: true, data: phase === 'waiting' ? WAITING : DIAGNOSED }
    }
    if (path === '/v1/admin/projects/p1/test-report') {
      phase = 'diagnosed'
      return { ok: true, data: { reportId: 'r-test', projectName: 'Demo' } }
    }
    throw new Error(`unexpected ${path}`)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(Harness)))
  })
}

describe('TimeToFirstDiagnosisCard', () => {
  it('shows the test-report diagnosis when the route returns testDiagnosisAt', async () => {
    phase = 'diagnosed'
    await render()
    expect(host.querySelector('[data-testid="ttfd-test-only"]')).toBeTruthy()
    expect(host.textContent).not.toContain('Waiting on the first report')
  })

  it('leaves the waiting copy only after a sent test report is fetched again', async () => {
    await render()
    expect(host.querySelector('[data-testid="ttfd-waiting"]')?.textContent).toContain(
      'Waiting on the first report from your app.',
    )
    const getsBeforeSend = diagnosisGets
    expect(getsBeforeSend).toBeGreaterThan(0)

    await act(async () => {
      await send('p1')
    })

    expect(diagnosisGets).toBeGreaterThan(getsBeforeSend)
    expect(api.invalidateApiCache).toHaveBeenCalledWith(TIME_TO_FIRST_DIAGNOSIS_PATH)
    expect(host.querySelector('[data-testid="ttfd-waiting"]')).toBeNull()
    expect(host.querySelector('[data-testid="ttfd-test-only"]')?.textContent).toContain(
      'Your test bug got its plain-English read',
    )
  })

  it('shows a measured first report in days, and a slow one stays neutral', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === TIME_TO_FIRST_DIAGNOSIS_PATH) {
        return {
          ok: true,
          data: {
            ...WAITING,
            firstDiagnosisAt: '2026-11-16T00:01:00.000Z',
            ms: (346 * 60 + 8) * 60_000,
            firstReportId: 'r1',
          },
        }
      }
      throw new Error(`unexpected ${path}`)
    })
    await render()
    const card = host.querySelector('[data-testid="ttfd-measured"]')
    expect(card?.textContent).toContain('14 d')
    expect(card?.textContent).toContain('Target: under 2 minutes')
    expect(card?.textContent).not.toContain('Waiting on the first report')
    expect(card?.className ?? '').not.toMatch(/info/)
    const caption = card?.querySelector('span')
    expect(caption?.className).toContain('text-fg-muted')
    expect(caption?.className).not.toMatch(/\btext-info\b/)
    const heading = card?.querySelector('p')
    expect(heading?.className).toContain('font-semibold')
    expect(heading?.className).toContain('text-fg-secondary')
    expect(heading?.className).not.toContain('uppercase')
  })
})
