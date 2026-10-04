/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/PrivacyPostureBadge.test.tsx
 * PURPOSE: QA item 226. A brand-new account with no project saw a red "Privacy
 *          unavailable" chip. No project is a normal first-run state, so the
 *          chip stays out of the way; a real failure still shows.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  projectId: null as string | null,
  page: {
    data: null as unknown,
    loading: false,
    error: null as string | null,
    errorMessage: null as string | null,
  },
  paths: [] as Array<string | null>,
}))

vi.mock('./ProjectSwitcher', () => ({ useActiveProjectId: () => state.projectId }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { ...state.page, reload: vi.fn() }
  },
}))

import { PrivacyPostureBadge } from './PrivacyPostureBadge'

let root: Root | null = null
let container: HTMLDivElement

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(createElement(MemoryRouter, null, createElement(PrivacyPostureBadge))))
}

beforeEach(() => {
  state.projectId = null
  state.page = { data: null, loading: false, error: null, errorMessage: null }
  state.paths = []
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('PrivacyPostureBadge', () => {
  it('shows nothing and asks nothing before the first project exists', () => {
    render()
    expect(container.textContent).toBe('')
    expect(state.paths.every((p) => p === null)).toBe(true)
  })

  it('shows nothing when the server says the account has no projects', () => {
    state.projectId = '11111111-1111-4111-8111-111111111111'
    state.page = { data: null, loading: false, error: 'no_projects (ERROR)', errorMessage: 'no_projects' }
    render()
    expect(container.textContent).toBe('')
  })

  it('still reports a real failure', () => {
    state.projectId = '11111111-1111-4111-8111-111111111111'
    state.page = { data: null, loading: false, error: 'Request failed (HTTP_500)', errorMessage: 'Request failed' }
    render()
    expect(container.textContent).toContain('Privacy unavailable')
  })
})
