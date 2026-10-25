/**
 * @vitest-environment jsdom
 *
 * The header's "All apps" scope (lib/projectScope.ts): stored choice, `?apps=`
 * precedence, the route registry, and that all-apps mode keeps the concrete
 * project for pages that show one app.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_SCOPE_EVENT,
  PROJECT_SCOPE_STORAGE_KEY,
  allAppsSupportFor,
  combinedFetchScope,
  getStoredProjectScopeMode,
  resolveProjectScopeMode,
  setStoredProjectScopeMode,
  useProjectScope,
  useSetProjectScopeMode,
  type ProjectScope,
} from './projectScope'
import { ACTIVE_PROJECT_STORAGE_KEY } from './activeProject'

const PROJECT_A = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'
const PROJECT_B = '542b34e0-019e-41fe-b900-7b637717bb86'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  window.localStorage.clear()
})

describe('stored scope', () => {
  it('defaults to one app and persists All apps', () => {
    expect(getStoredProjectScopeMode()).toBe('project')
    setStoredProjectScopeMode('all')
    expect(window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY)).toBe('all')
    expect(getStoredProjectScopeMode()).toBe('all')
    setStoredProjectScopeMode('project')
    expect(window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY)).toBeNull()
  })

  it('fires its event only on a real change', () => {
    const listener = vi.fn()
    window.addEventListener(PROJECT_SCOPE_EVENT, listener)
    setStoredProjectScopeMode('all')
    setStoredProjectScopeMode('all')
    setStoredProjectScopeMode('project')
    window.removeEventListener(PROJECT_SCOPE_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not touch the active project', () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT_A)
    setStoredProjectScopeMode('all')
    expect(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(PROJECT_A)
  })
})

describe('combinedFetchScope', () => {
  it('drops the project pin only in All apps mode', () => {
    expect(combinedFetchScope('all')).toBe('enumeration')
    expect(combinedFetchScope('project')).toBe('project')
  })
})

describe('resolveProjectScopeMode', () => {
  it('lets ?apps=all win, ignores other values, else uses storage', () => {
    expect(resolveProjectScopeMode('all', 'project')).toBe('all')
    expect(resolveProjectScopeMode(null, 'all')).toBe('all')
    expect(resolveProjectScopeMode(null, 'project')).toBe('project')
    expect(resolveProjectScopeMode('bogus', 'project')).toBe('project')
  })
})

describe('allAppsSupportFor', () => {
  it('combines on /ci, says nothing on account-wide pages, one app elsewhere', () => {
    expect(allAppsSupportFor('/ci')).toBe('combined')
    expect(allAppsSupportFor('/portfolio')).toBe('account')
    expect(allAppsSupportFor('/projects')).toBe('account')
    expect(allAppsSupportFor('/org/acme/settings/members')).toBe('account')
    expect(allAppsSupportFor('/projects/abc/qa-coverage/s1')).toBe('single')
    expect(allAppsSupportFor('/reports')).toBe('combined')
    expect(allAppsSupportFor('/reports/123')).toBe('single')
    expect(allAppsSupportFor('/fixes')).toBe('single')
    expect(allAppsSupportFor('/cinema')).toBe('single')
  })
})

describe('useProjectScope', () => {
  let root: Root
  let host: HTMLDivElement
  const seen: { scope: ProjectScope | null; search: string; set: ((m: 'all' | 'project') => void) | null } = {
    scope: null,
    search: '',
    set: null,
  }

  function Probe() {
    seen.scope = useProjectScope()
    seen.set = useSetProjectScopeMode()
    seen.search = useLocation().search
    return null
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function render(url: string) {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Probe)))
    })
  }

  it('returns the URL project in one-app mode', async () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT_B)
    await render(`/ci?project=${PROJECT_A}`)
    expect(seen.scope).toEqual({ mode: 'project', projectId: PROJECT_A })
  })

  it('falls back to the stored project when the URL has none', async () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, PROJECT_B)
    await render('/ci')
    expect(seen.scope).toEqual({ mode: 'project', projectId: PROJECT_B })
  })

  it('reads All apps from ?apps=all', async () => {
    await render(`/ci?project=${PROJECT_A}&apps=all`)
    expect(seen.scope).toEqual({ mode: 'all' })
  })

  it('reads All apps from storage when the URL drops the param (in-app links)', async () => {
    setStoredProjectScopeMode('all')
    await render(`/ci?project=${PROJECT_A}`)
    expect(seen.scope).toEqual({ mode: 'all' })
  })

  it('switches in storage and the URL together, keeping ?project=', async () => {
    await render(`/ci?project=${PROJECT_A}`)
    await act(async () => seen.set!('all'))
    expect(seen.scope).toEqual({ mode: 'all' })
    expect(getStoredProjectScopeMode()).toBe('all')
    const params = new URLSearchParams(seen.search)
    expect(params.get('apps')).toBe('all')
    expect(params.get('project')).toBe(PROJECT_A)

    await act(async () => seen.set!('project'))
    expect(seen.scope).toEqual({ mode: 'project', projectId: PROJECT_A })
    expect(getStoredProjectScopeMode()).toBe('project')
    expect(new URLSearchParams(seen.search).has('apps')).toBe(false)
  })
})
