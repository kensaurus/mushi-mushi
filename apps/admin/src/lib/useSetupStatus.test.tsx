/**
 * Console audit 2026-10-20, B1: one slow or failed `/v1/admin/setup` must
 * not turn the shell into "create your first project". The hook keeps the
 * remembered answer and reports `resolved: false` so gates stay quiet.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageData = vi.hoisted(() => ({
  state: { data: null as unknown, loading: false, error: null as string | null, reload: () => {} },
}))

vi.mock('./usePageData', () => ({ usePageData: () => pageData.state }))
vi.mock('./supabase', () => ({ invalidateApiCache: vi.fn() }))

import { SETUP_LOAD_DEADLINE_MS, useSetupStatus, type UseSetupStatusResult } from './useSetupStatus'
import { forgetHasAnyProject, rememberHasAnyProject } from './projectPresence'

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: UseSetupStatusResult | null = null

function Probe() {
  latest = useSetupStatus(null)
  return null
}

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(createElement(Probe))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  forgetHasAnyProject()
  window.localStorage.clear()
  latest = null
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useSetupStatus project presence', () => {
  it('a failed fetch with nothing cached is unresolved and does not claim "no projects"', () => {
    pageData.state = { data: null, loading: false, error: 'The server took too long to answer', reload: () => {} }
    render()
    expect(latest?.resolved).toBe(false)
    expect(latest?.hasAnyProject).toBe(true)
    expect(latest?.error).toContain('too long')
  })

  it('a failed fetch keeps the remembered answer from an earlier session', () => {
    rememberHasAnyProject(false)
    pageData.state = { data: null, loading: false, error: 'offline', reload: () => {} }
    render()
    expect(latest?.resolved).toBe(false)
    expect(latest?.hasAnyProject).toBe(false)
  })

  it('an unfinished load settles so the header can offer a retry', () => {
    vi.useFakeTimers()
    try {
      pageData.state = { data: null, loading: true, error: null, reload: () => {} }
      render()
      expect(latest?.error).toBeNull()
      act(() => {
        vi.advanceTimersByTime(SETUP_LOAD_DEADLINE_MS)
      })
      expect(latest?.error).toMatch(/too long/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resolved response is the truth and is remembered for next time', () => {
    pageData.state = {
      data: { has_any_project: true, projects: [] },
      loading: false,
      error: null,
      reload: () => {},
    }
    render()
    expect(latest?.resolved).toBe(true)
    expect(latest?.hasAnyProject).toBe(true)
    expect(window.localStorage.getItem('mushi:has_any_project')).toBe('1')
  })

  it('a resolved "no projects" answer still says no', () => {
    rememberHasAnyProject(true)
    pageData.state = {
      data: { has_any_project: false, projects: [] },
      loading: false,
      error: null,
      reload: () => {},
    }
    render()
    expect(latest?.resolved).toBe(true)
    expect(latest?.hasAnyProject).toBe(false)
  })
})
