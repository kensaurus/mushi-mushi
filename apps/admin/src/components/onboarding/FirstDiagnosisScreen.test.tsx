/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/onboarding/FirstDiagnosisScreen.test.tsx
 * PURPOSE: The first-diagnosis screen records the activation step
 *          `diagnosis_viewed` once the classified test report renders.
 *
 * Why (2026-09-22): the setup_funnel_events CHECK and the server's
 * FunnelEventName allowed `diagnosis_viewed` from 2026-09-21, but nothing
 * wrote it, so the onboarding funnel had a step that always read zero.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidateApiCache: vi.fn() }))
const tracking = vi.hoisted(() => ({ trackSelf: vi.fn(), trackAdHoc: vi.fn() }))

vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/track', () => tracking)
vi.mock('../SdkInstallCard', () => ({ SdkInstallCard: () => null }))
vi.mock('../ClientConnectButton', () => ({ ClientConnectButton: () => null }))
vi.mock('../FirstRunTour', () => ({ startFirstRunTour: vi.fn() }))
vi.mock('@mushi-mushi/mcp/clients', () => ({ getMcpClient: () => ({ id: 'cursor' }) }))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const REPORT = '22222222-2222-4222-8222-222222222222'
const VIEWED_PATH = `/v1/admin/projects/${PROJECT}/setup-funnel/diagnosis-viewed`

type Call = [string, { method?: string; body?: string } | undefined]

function viewedCalls(): Call[] {
  return (api.apiFetch.mock.calls as Call[]).filter(([path]) => path === VIEWED_PATH)
}

/** Test report accepted, then the first poll returns a classified row. */
function serveDiagnosis(viewed: { ok: boolean } = { ok: true }) {
  api.apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/test-report')) return { ok: true, data: { reportId: REPORT, projectName: 'Demo' } }
    if (path.startsWith('/v1/admin/reports/')) {
      return {
        ok: true,
        data: { id: REPORT, title: 'Login fails on iPad Safari', summary: 'Session 401', severity: 'high' },
      }
    }
    if (path === VIEWED_PATH) return viewed.ok ? { ok: true, data: { ok: true } } : { ok: false, error: { code: 'X' } }
    return { ok: false, error: { code: 'UNEXPECTED' } }
  })
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('FirstDiagnosisScreen — diagnosis_viewed', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    api.apiFetch.mockReset()
    tracking.trackSelf.mockReset()
    tracking.trackAdHoc.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function renderScreen(): Promise<void> {
    // Fresh module per test so the per-page-load dedupe starts empty.
    const { FirstDiagnosisScreen } = await import('./FirstDiagnosisScreen')
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(FirstDiagnosisScreen, { projectId: PROJECT, projectName: 'Demo' }),
        ),
      )
    })
  }

  async function sendAndDiagnose(): Promise<void> {
    const send = container.querySelector<HTMLButtonElement>('[data-testid="first-diagnosis-send"]')
    expect(send).toBeTruthy()
    await act(async () => {
      send!.click()
      await flush()
    })
    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flush()
    })
  }

  it('posts diagnosis_viewed once the diagnosis renders, with the report id', async () => {
    serveDiagnosis()
    await renderScreen()
    expect(viewedCalls()).toHaveLength(0)

    await sendAndDiagnose()

    expect(container.querySelector('[data-testid="first-diagnosis-card"]')).toBeTruthy()
    expect(viewedCalls()).toHaveLength(1)
    const [, init] = viewedCalls()[0]!
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body ?? '{}')).toEqual({ reportId: REPORT })
    expect(tracking.trackSelf).toHaveBeenCalledWith('report_opened', expect.objectContaining({ report_id: REPORT }))
  })

  it('does not post before a diagnosis exists', async () => {
    serveDiagnosis()
    await renderScreen()
    const send = container.querySelector<HTMLButtonElement>('[data-testid="first-diagnosis-send"]')
    await act(async () => {
      send!.click()
      await flush()
    })
    // Sent, still polling: no diagnosis yet.
    expect(viewedCalls()).toHaveLength(0)
  })

  it('sends once per project per page load, even when the screen remounts', async () => {
    serveDiagnosis()
    await renderScreen()
    await sendAndDiagnose()
    act(() => root.unmount())
    root = createRoot(container)
    await renderScreen()
    await sendAndDiagnose()
    expect(viewedCalls()).toHaveLength(1)
  })

  it('retries on the next diagnosis when the post failed', async () => {
    serveDiagnosis({ ok: false })
    await renderScreen()
    await sendAndDiagnose()
    await act(async () => {
      await flush()
    })
    serveDiagnosis({ ok: true })
    act(() => root.unmount())
    root = createRoot(container)
    const { FirstDiagnosisScreen } = await import('./FirstDiagnosisScreen')
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(FirstDiagnosisScreen, { projectId: PROJECT, projectName: 'Demo' }),
        ),
      )
    })
    await sendAndDiagnose()
    expect(viewedCalls()).toHaveLength(2)
  })

  it('records the install-first branch as an ad-hoc event, not a funnel step', async () => {
    serveDiagnosis()
    await renderScreen()
    const installFirst = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Install the SDK first instead'),
    )
    expect(installFirst).toBeTruthy()
    act(() => installFirst!.click())
    expect(tracking.trackAdHoc).toHaveBeenCalledWith('onboarding_install_first_clicked', { project_id: PROJECT })
    expect(tracking.trackSelf).not.toHaveBeenCalled()
  })
})
