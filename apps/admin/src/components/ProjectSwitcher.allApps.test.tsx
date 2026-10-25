/**
 * @vitest-environment jsdom
 *
 * The header switcher's "All apps" row (lib/projectScope.ts): it renders at
 * the top of the list with a count, selecting it shows "All apps" in the
 * header while `?project=` keeps the concrete app, picking an app leaves
 * all-apps mode, and a stored project that no longer exists still falls back
 * to a real one.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT_A = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'
const PROJECT_B = '542b34e0-019e-41fe-b900-7b637717bb86'
const GONE = '00000000-0000-4000-8000-000000000000'
const ORG_A = '8f1f6c5e-2d7a-4f0b-9a1e-6c2b0d4e5f10'
const ORG_B = '0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e60'

function setupProject(id: string, name: string) {
  return { project_id: id, project_name: name, project_slug: name, report_count: 3, required_complete: 2, required_total: 4, steps: [] }
}

const setup = vi.hoisted(() => ({
  value: null as unknown,
}))

vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => setup.value }))
vi.mock('../lib/useProjectSnapshots', () => ({ useProjectSnapshots: () => ({ byId: new Map(), projects: [] }) }))
const pageData = vi.hoisted(() => ({ byPath: new Map<string, unknown>() }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: (path ? pageData.byPath.get(path) : null) ?? null,
    loading: false,
    error: null,
    isValidating: false,
    reload: () => {},
  }),
}))
vi.mock('../lib/useCreateProject', () => ({ useCreateProject: () => ({ create: vi.fn(), creating: false, error: null }) }))
vi.mock('../lib/projectGroups', () => ({
  useProjectGroups: () => ({ data: { groups: [] } }),
  readActiveGroup: () => null,
  writeActiveGroup: () => {},
}))
vi.mock('../lib/toast', () => ({ useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }) }))
vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async () => ({ ok: false })),
  invalidateApiCache: vi.fn(),
}))
vi.mock('./ProjectFavicon', () => ({ ProjectFavicon: () => null }))
vi.mock('./ProjectHeartbeatStrip', () => ({ ProjectHeartbeatStrip: () => null }))
vi.mock('./ProjectSnapshotMeta', () => ({ ProjectSnapshotMeta: () => null }))

import { ProjectSwitcher } from './ProjectSwitcher'
import { ACTIVE_PROJECT_STORAGE_KEY } from '../lib/activeProject'
import { ACTIVE_ORG_STORAGE_KEY } from '../lib/activeOrg'
import { PROJECT_DIRECTORY_PATH } from '../lib/crossTeamProject'
import { getStoredProjectScopeMode, requestOpenProjectSwitcher, setStoredProjectScopeMode } from '../lib/projectScope'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let search = ''

function LocationProbe() {
  search = useLocation().search
  return null
}

beforeEach(() => {
  window.localStorage.clear()
  pageData.byPath.clear()
  setup.value = {
    loading: false,
    error: null,
    reload: vi.fn(),
    data: { projects: [setupProject(PROJECT_A, 'glot.it'), setupProject(PROJECT_B, 'yen-yen')], admin_endpoint_host: null },
  }
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
    root.render(
      createElement(MemoryRouter, { initialEntries: [url] }, createElement(ProjectSwitcher), createElement(LocationProbe)),
    )
  })
}

const chip = () => host.querySelector('[data-testid="project-switcher-chip"]') as HTMLButtonElement
const allRow = () => host.querySelector('[data-testid="project-switcher-all-apps"]') as HTMLButtonElement | null
const params = () => new URLSearchParams(search)

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}

describe('ProjectSwitcher — All apps', () => {
  it('lists All apps first in the listbox, with the app count, as an option', async () => {
    await render(`/ci?project=${PROJECT_A}`)
    expect(chip().textContent).toContain('glot.it')
    await click(chip())
    const row = allRow()!
    const listbox = row.closest('[role="listbox"]')!
    expect(listbox.querySelector('[role="option"]')).toBe(row)
    expect(row.getAttribute('role')).toBe('option')
    expect(row.getAttribute('aria-selected')).toBe('false')
    expect(row.textContent).toContain('All apps')
    expect(row.textContent).toContain('2 apps')
  })

  it('says how many teams the count spans, so it cannot read as disagreeing with the one-team Apps page', async () => {
    window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, ORG_A)
    pageData.byPath.set(PROJECT_DIRECTORY_PATH, {
      teams: [
        { id: ORG_A, name: 'Kenji apps', role: 'owner', isPersonal: false },
        { id: ORG_B, name: 'Side projects', role: 'owner', isPersonal: false },
      ],
      projects: [
        { id: PROJECT_A, name: 'glot.it', organizationId: ORG_A },
        { id: PROJECT_B, name: 'yen-yen', organizationId: ORG_A },
        { id: GONE, name: 'mushi-mushi', organizationId: ORG_B },
      ],
    })
    await render(`/ci?project=${PROJECT_A}`)
    await click(chip())
    expect(allRow()!.textContent).toContain('3 apps in 2 teams combined')
  })

  it('selecting All apps shows it in the header and keeps the concrete app in the URL', async () => {
    await render(`/ci?project=${PROJECT_A}`)
    await click(chip())
    await click(allRow()!)
    expect(chip().textContent).toContain('All apps')
    expect(chip().getAttribute('aria-label')).toBe('Project: All apps — switch project')
    expect(params().get('apps')).toBe('all')
    expect(params().get('project')).toBe(PROJECT_A)
    expect(getStoredProjectScopeMode()).toBe('all')
    expect(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(PROJECT_A)

    await click(chip())
    expect(allRow()!.getAttribute('aria-selected')).toBe('true')
    const selected = Array.from(host.querySelectorAll('[role="option"][aria-selected="true"]'))
    expect(selected).toEqual([allRow()])
  })

  it('picking an app leaves All apps', async () => {
    setStoredProjectScopeMode('all')
    await render(`/ci?project=${PROJECT_A}&apps=all`)
    await click(chip())
    const yen = Array.from(host.querySelectorAll('[role="option"]')).find((el) => el.textContent?.includes('yen-yen')) as HTMLElement
    await click(yen)
    expect(chip().textContent).toContain('yen-yen')
    expect(params().has('apps')).toBe(false)
    expect(params().get('project')).toBe(PROJECT_B)
    expect(getStoredProjectScopeMode()).toBe('project')
  })

  it('remembers a shared ?apps=all link and restores it after an in-app link drops it', async () => {
    await render(`/ci?project=${PROJECT_A}&apps=all`)
    expect(getStoredProjectScopeMode()).toBe('all')
    await render('/reports')
    expect(params().get('apps')).toBe('all')
    expect(chip().textContent).toContain('All apps')
  })

  it('falls back to a real app when the stored one no longer exists, staying in All apps', async () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, GONE)
    setStoredProjectScopeMode('all')
    await render('/ci')
    expect(params().get('project')).toBe(PROJECT_A)
    expect(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(PROJECT_A)
    expect(params().get('apps')).toBe('all')
    expect(chip().textContent).toContain('All apps')
  })

  it('drops an unknown ?apps= value', async () => {
    await render(`/ci?project=${PROJECT_A}&apps=bogus`)
    expect(params().has('apps')).toBe(false)
    expect(chip().textContent).toContain('glot.it')
  })

  it('opens when the one-app notice asks it to', async () => {
    await render(`/reports?project=${PROJECT_A}&apps=all`)
    expect(allRow()).toBeNull()
    await act(async () => requestOpenProjectSwitcher())
    expect(allRow()).not.toBeNull()
  })
})
