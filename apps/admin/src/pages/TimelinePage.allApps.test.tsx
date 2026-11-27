/**
 * @vitest-environment jsdom
 *
 * A timeline is one app's releases, so "All apps" cannot combine it. Under All
 * apps the page names the app it shows and an empty timeline offers the
 * switcher; it used to show the last app opened, empty, unnamed (2026-11-27).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({ data: { projects: [{ project_id: PROJECT, project_name: 'glot.it' }] }, activeProject: { project_id: PROJECT, project_name: 'glot.it' } }),
}))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: { points: [], surfaces: [], rail: 'runs', settings: { keep_releases: 24, auto_pin: false }, month: { reports_closed: 0, releases: 0, runs: 0, screens_improved: 0, cost_usd: null, judged: 0, cached: 0, top_reports: [], movers: [] } },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))
vi.mock('../lib/useActiveOrgRole', () => ({ useActiveOrgRole: () => ({ role: 'owner' }) }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ isOperator: false }) }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title, projectScope }: { title: string; projectScope?: string | null }) =>
    createElement('h1', { 'data-testid': 'header' }, projectScope ? `${title} · ${projectScope}` : title),
}))

import { TimelinePage } from './TimelinePage'
import { OPEN_PROJECT_SWITCHER_EVENT } from '../lib/projectScope'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(TimelinePage)))
  })
}

describe('TimelinePage under All apps', () => {
  it('names the app and offers the switcher when its timeline is empty', async () => {
    await render(`/timeline?project=${PROJECT}&apps=all`)
    expect(host.querySelector('[data-testid="header"]')!.textContent).toBe('Timeline · glot.it')
    expect(host.textContent).toContain("Nothing on glot.it's timeline yet")
    expect(host.textContent).toContain('The timeline shows one app at a time.')
    const opened = vi.fn()
    window.addEventListener(OPEN_PROJECT_SWITCHER_EVENT, opened)
    await act(async () => {
      ;(host.querySelector('[data-testid="timeline-switch-app"]') as HTMLButtonElement).click()
    })
    window.removeEventListener(OPEN_PROJECT_SWITCHER_EVENT, opened)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('names the app without the switcher for one app', async () => {
    await render(`/timeline?project=${PROJECT}`)
    expect(host.querySelector('[data-testid="header"]')!.textContent).toBe('Timeline · glot.it')
    expect(host.querySelector('[data-testid="timeline-switch-app"]')).toBeNull()
  })
})
