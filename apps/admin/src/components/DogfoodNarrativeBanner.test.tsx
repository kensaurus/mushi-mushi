/**
 * @vitest-environment jsdom
 *
 * The fragile-area line on /reports used to mount only after the dashboard
 * fetch, pushing the queue. The reserve keeps that row's height while loading.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  setupLoading: true,
  reportCount: 0,
  projectName: 'Checkout',
  hasProject: true,
  dashLoading: true,
  top: null as null | { component: string; count: number; draftedFixes: number; mergedFixes: number },
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: state.top ? { topComponents: [state.top] } : { topComponents: [] },
    loading: state.dashLoading,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({
    loading: state.setupLoading,
    activeProject: state.hasProject
      ? { project_name: state.projectName, report_count: state.reportCount }
      : null,
  }),
}))

vi.mock('./ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))

import { DogfoodNarrativeBanner } from './DogfoodNarrativeBanner'

let root: Root | null = null
let container: HTMLDivElement

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(createElement(MemoryRouter, null, createElement(DogfoodNarrativeBanner)))
  })
}

beforeEach(() => {
  state.setupLoading = true
  state.reportCount = 4
  state.hasProject = true
  state.dashLoading = true
  state.top = null
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('DogfoodNarrativeBanner', () => {
  it('reserves the fragile-area row while dashboard data is loading', () => {
    render()
    expect(container.querySelector('[data-testid="reports-narrative-reserve"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Open the worst')
  })

  it('replaces the reserve with the sentence once a fragile area is known', () => {
    state.setupLoading = false
    state.dashLoading = false
    state.top = { component: 'Checkout', count: 6, draftedFixes: 2, mergedFixes: 1 }
    render()
    expect(container.querySelector('[data-testid="reports-narrative-reserve"]')).toBeNull()
    expect(container.textContent).toContain('Checkout is your most fragile area')
    expect(container.textContent).toContain('Open the worst')
  })

  it('stays out of an inbox that has no reports', () => {
    state.setupLoading = false
    state.dashLoading = true
    state.reportCount = 0
    render()
    expect(container.querySelector('[data-testid="reports-narrative-reserve"]')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
