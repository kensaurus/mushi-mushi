/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/lib/useTimeToFirstDiagnosis.test.tsx
 * PURPOSE: The Verify card and the Set up rail share one fetch. Invalidating
 *          after a classified test report must reload every mounted reader
 *          (report 9b7624e6). The mount fetch itself must not count as that.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ reload: vi.fn(), invalidateApiCache: vi.fn() }))

vi.mock('./supabase', () => ({
  invalidateApiCache: api.invalidateApiCache,
}))

vi.mock('./usePageData', () => ({
  usePageData: () => ({
    data: null,
    loading: false,
    error: null,
    errorCode: null,
    errorMessage: null,
    requestId: null,
    errorEndpoint: null,
    isValidating: false,
    lastFetchedAt: null,
    reload: api.reload,
  }),
}))

import { invalidateTimeToFirstDiagnosis, useTimeToFirstDiagnosis } from './useTimeToFirstDiagnosis'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe() {
  useTimeToFirstDiagnosis()
  return null
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  api.reload.mockReset()
  api.invalidateApiCache.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useTimeToFirstDiagnosis', () => {
  it('reloads mounted readers when the diagnosis route is invalidated', () => {
    act(() => {
      root.render(createElement(Probe))
    })
    expect(api.reload).not.toHaveBeenCalled()

    act(() => {
      invalidateTimeToFirstDiagnosis()
    })

    expect(api.invalidateApiCache).toHaveBeenCalledWith('/v1/admin/onboarding/time-to-first-diagnosis')
    expect(api.reload).toHaveBeenCalledTimes(1)
  })
})
