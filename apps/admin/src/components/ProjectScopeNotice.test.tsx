/**
 * @vitest-environment jsdom
 *
 * In All apps mode, a page that shows one app says which app in one line and
 * still renders that app's data; pages that combine apps (/ci) or never show
 * one (/portfolio) say nothing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT_A = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'
const PROJECT_B = '542b34e0-019e-41fe-b900-7b637717bb86'

const projects = [
  { project_id: PROJECT_A, project_name: 'glot.it' },
  { project_id: PROJECT_B, project_name: 'yen-yen' },
]

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: (activeProjectId?: string | null) => ({
    data: { projects },
    activeProject: projects.find((p) => p.project_id === activeProjectId) ?? projects[0],
  }),
}))

import { ProjectScopeNotice } from './ProjectScopeNotice'
import { useActiveProjectId } from './ProjectSwitcher'
import { OPEN_PROJECT_SWITCHER_EVENT, setStoredProjectScopeMode } from '../lib/projectScope'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A page that has not opted in: it reads the active project as before. */
function OneAppPage() {
  const projectId = useActiveProjectId()
  return createElement('div', { 'data-testid': 'page-data' }, `reports for ${projectId}`)
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  window.localStorage.clear()
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
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(ProjectScopeNotice), createElement(OneAppPage)))
  })
}

const notice = () => host.querySelector('[data-testid="project-scope-notice"]') as HTMLElement | null
const pageData = () => host.querySelector('[data-testid="page-data"]')!.textContent

describe('ProjectScopeNotice', () => {
  it('names the app on a one-app page in All apps mode, and the page keeps its data', async () => {
    await render(`/fixes?project=${PROJECT_B}&apps=all`)
    expect(notice()!.textContent).toContain('This page shows one app at a time: yen-yen.')
    expect(notice()!.getAttribute('role')).toBe('status')
    expect(pageData()).toBe(`reports for ${PROJECT_B}`)
  })

  it('also shows when All apps comes from storage', async () => {
    setStoredProjectScopeMode('all')
    await render(`/fixes?project=${PROJECT_A}`)
    expect(notice()!.textContent).toContain('glot.it')
  })

  it('"Switch app" opens the header switcher', async () => {
    const listener = vi.fn()
    window.addEventListener(OPEN_PROJECT_SWITCHER_EVENT, listener)
    await render(`/fixes?project=${PROJECT_A}&apps=all`)
    const button = Array.from(notice()!.querySelectorAll('button')).find((b) => b.textContent === 'Switch app')!
    await act(async () => button.click())
    window.removeEventListener(OPEN_PROJECT_SWITCHER_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stays quiet in one-app mode', async () => {
    await render(`/reports?project=${PROJECT_A}`)
    expect(notice()).toBeNull()
    expect(pageData()).toBe(`reports for ${PROJECT_A}`)
  })

  it('stays quiet on pages that combine apps or never show one', async () => {
    await render(`/ci?project=${PROJECT_A}&apps=all`)
    expect(notice()).toBeNull()
    await render(`/reports?project=${PROJECT_A}&apps=all`)
    expect(notice()).toBeNull()
    await render(`/portfolio?project=${PROJECT_A}&apps=all`)
    expect(notice()).toBeNull()
  })
})
