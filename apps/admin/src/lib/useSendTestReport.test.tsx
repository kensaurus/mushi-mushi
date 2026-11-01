/**
 * @vitest-environment jsdom
 *
 * Sending a test report has to refresh the Set up diagnosis card. The POST
 * returns only after the classified row is stored (report 9b7624e6).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  invalidateSetupStatus: vi.fn(),
  invalidateTimeToFirstDiagnosis: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('./useSetupStatus', () => ({ invalidateSetupStatus: api.invalidateSetupStatus }))
vi.mock('./useTimeToFirstDiagnosis', () => ({ invalidateTimeToFirstDiagnosis: api.invalidateTimeToFirstDiagnosis }))
vi.mock('./toast', () => ({ useToast: () => ({ success: api.success, error: api.error }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

import { useSendTestReport } from './useSendTestReport'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function Probe() {
  const send = useSendTestReport()
  return createElement('button', {
    type: 'button',
    onClick: () => {
      void send('p1')
    },
  }, 'send')
}

beforeEach(() => {
  api.apiFetch.mockReset()
  api.invalidateSetupStatus.mockClear()
  api.invalidateTimeToFirstDiagnosis.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(createElement(Probe))
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useSendTestReport', () => {
  it('refreshes the diagnosis card after the test report is stored', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: { reportId: 'r1', projectName: 'Demo' } })
    await act(async () => {
      host.querySelector('button')!.click()
    })
    expect(api.invalidateTimeToFirstDiagnosis).toHaveBeenCalledOnce()
    expect(api.invalidateSetupStatus).toHaveBeenCalledOnce()
  })

  it('a failed send leaves the diagnosis card alone', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { message: 'nope' } })
    await act(async () => {
      host.querySelector('button')!.click()
    })
    expect(api.invalidateTimeToFirstDiagnosis).not.toHaveBeenCalled()
  })
})
