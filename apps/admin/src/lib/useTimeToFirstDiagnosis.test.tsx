/**
 * @vitest-environment jsdom
 *
 * Report 9b7624e6: the Test it card fetched time-to-first-diagnosis once, so
 * it stayed on "Waiting…" after the test report was classified. Invalidating
 * must drop the GET cache and move every mounted reader's dep.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageData = vi.hoisted(() => ({ usePageData: vi.fn() }))
const cache = vi.hoisted(() => ({ invalidateApiCache: vi.fn() }))

vi.mock('./usePageData', () => ({ usePageData: pageData.usePageData }))
vi.mock('./supabase', () => ({ invalidateApiCache: cache.invalidateApiCache }))

import {
  invalidateTimeToFirstDiagnosis,
  TIME_TO_FIRST_DIAGNOSIS_PATH,
  useTimeToFirstDiagnosis,
} from './useTimeToFirstDiagnosis'

let root: Root | null = null
let container: HTMLDivElement | null = null

function Probe({ projectId }: { projectId?: string | null }) {
  useTimeToFirstDiagnosis(projectId)
  return null
}

function render(projectId?: string | null) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(createElement(Probe, { projectId }))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  pageData.usePageData.mockReset()
  cache.invalidateApiCache.mockReset()
  pageData.usePageData.mockReturnValue({ data: null, loading: false, error: null, reload: () => {} })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useTimeToFirstDiagnosis', () => {
  it('refetches every reader after a classified test report', () => {
    render('p1')
    const first = pageData.usePageData.mock.calls.at(-1)?.[1].deps[1] as number
    expect(pageData.usePageData).toHaveBeenLastCalledWith(TIME_TO_FIRST_DIAGNOSIS_PATH, {
      deps: ['p1', first],
    })
    act(() => invalidateTimeToFirstDiagnosis())
    expect(cache.invalidateApiCache).toHaveBeenCalledWith(TIME_TO_FIRST_DIAGNOSIS_PATH)
    expect(pageData.usePageData).toHaveBeenLastCalledWith(TIME_TO_FIRST_DIAGNOSIS_PATH, {
      deps: ['p1', first + 1],
    })
  })

  it('does not request the route when there is no app', () => {
    render(null)
    expect(pageData.usePageData).toHaveBeenLastCalledWith(null, { deps: ['', expect.any(Number)] })
  })
})
