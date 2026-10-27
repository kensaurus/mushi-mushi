/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/lib/useSendTestReport.test.tsx
 * PURPOSE: A successful "Send test report" refreshes the Verify card's
 *          time-to-first-diagnosis read. A failed send does not
 *          (report 9b7624e6).
 */

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  invalidateSetupStatus: vi.fn(),
  invalidateTimeToFirstDiagnosis: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('./supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('./useSetupStatus', () => ({ invalidateSetupStatus: api.invalidateSetupStatus }))
vi.mock('./useTimeToFirstDiagnosis', () => ({
  invalidateTimeToFirstDiagnosis: api.invalidateTimeToFirstDiagnosis,
}))
vi.mock('./toast', () => ({ useToast: () => ({ success: api.success, error: api.error }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => api.navigate }))

import { useSendTestReport } from './useSendTestReport'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'

function Probe({ projectId }: { projectId: string }) {
  const send = useSendTestReport()
  useEffect(() => {
    void send(projectId)
  }, [send, projectId])
  return null
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  api.apiFetch.mockReset()
  api.invalidateSetupStatus.mockReset()
  api.invalidateTimeToFirstDiagnosis.mockReset()
  api.success.mockReset()
  api.error.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useSendTestReport', () => {
  it('refreshes the first-diagnosis card after the test report is accepted', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: { reportId: 'r1', projectName: 'Demo' } })
    await act(async () => {
      root.render(createElement(Probe, { projectId: PROJECT }))
    })
    expect(api.invalidateTimeToFirstDiagnosis).toHaveBeenCalledTimes(1)
    expect(api.invalidateSetupStatus).toHaveBeenCalledTimes(1)
  })

  it('does not refresh the card when the send fails', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { message: 'nope' } })
    await act(async () => {
      root.render(createElement(Probe, { projectId: PROJECT }))
    })
    expect(api.invalidateTimeToFirstDiagnosis).not.toHaveBeenCalled()
  })
})
