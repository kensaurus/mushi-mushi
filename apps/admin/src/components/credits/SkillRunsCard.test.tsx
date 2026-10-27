/**
 * @vitest-environment jsdom
 *
 * The skill-run app picker on /credits starts on the open app — the one the
 * "one app at a time" notice names — from ?project= or the stored app. Every
 * other app stays choosable, and runs from the whole team stay listed.
 * "Run on" offers your fix and skill lanes for the app and sends laneId.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_PROJECT_STORAGE_KEY } from '../../lib/activeProject'

const GLOT = '542b34e0-019e-41fe-b900-7b637717bb86'
const LETS = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'

const projects = [
  { id: LETS, name: 'lets-talk' },
  { id: GLOT, name: 'glot.it' },
]

const mocks = vi.hoisted(() => ({
  loadSkillRuns: vi.fn(),
  startSkillRun: vi.fn(),
  lanes: null as unknown,
}))

vi.mock('../../lib/skillRuns', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, loadSkillRuns: mocks.loadSkillRuns, startSkillRun: mocks.startSkillRun }
})
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({ data: path === '/v1/admin/work/lanes' ? mocks.lanes : null, loading: false, error: null, isValidating: false, reload: () => {}, lastFetchedAt: null }),
}))

import { SkillRunsCard } from './SkillRunsCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function run(id: string, projectId: string) {
  return {
    id,
    project_id: projectId,
    skill_slug: 'audit-accessibility',
    scope: 'the booking flow',
    rounds_max: 3,
    round: 1,
    auto_merge: true,
    status: 'done' as const,
    stop_reason: 'Finished.',
    current_report_id: null,
    history: [],
    created_at: '2026-10-25T00:00:00Z',
    updated_at: '2026-10-25T00:00:00Z',
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  window.localStorage.clear()
  mocks.lanes = null
  mocks.startSkillRun.mockReset()
  mocks.startSkillRun.mockResolvedValue({ ok: true, data: { run: { id: 'new' } } })
  mocks.loadSkillRuns.mockReset()
  mocks.loadSkillRuns.mockResolvedValue({
    ok: true,
    data: {
      skills: [{ slug: 'audit-accessibility', label: 'Accessibility', measure: 'axe violations', inCatalog: true }],
      runs: [run('r-lets', LETS), run('r-glot', GLOT)],
    },
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.localStorage.clear()
})

async function render(url: string) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(SkillRunsCard, { projects })))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function appSelect() {
  const select = Array.from(host.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.textContent === 'glot.it'))
  if (!select) throw new Error('no app select')
  return select
}

describe('SkillRunsCard app picker', () => {
  it('starts on the open app from ?project= and still lists every app and every run', async () => {
    await render(`/credits?project=${GLOT}&apps=all`)
    const select = appSelect()
    expect(select.value).toBe(GLOT)
    expect(select.disabled).toBe(false)
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['lets-talk', 'glot.it'])
    const items = host.querySelectorAll('ul li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('lets-talk')
    expect(items[1].textContent).toContain('glot.it')
    expect(mocks.loadSkillRuns).toHaveBeenCalledWith()
  })

  it('starts on the stored app when the URL has no project', async () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, GLOT)
    await render('/credits?apps=all')
    expect(appSelect().value).toBe(GLOT)
    expect(appSelect().disabled).toBe(false)
    expect(Array.from(appSelect().options).map((o) => o.value)).toEqual([LETS, GLOT])
  })

  it('starts on the first app when nothing is open, and a manual pick sticks', async () => {
    await render('/credits')
    const select = appSelect()
    expect(select.value).toBe(LETS)
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(select, GLOT)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(appSelect().value).toBe(GLOT)
    expect(appSelect().disabled).toBe(false)
  })
})

describe('SkillRunsCard run on a local lane (ADR 0042 amendment)', () => {
  const lane = (id: string, name: string, mode: string, projectId = GLOT) => ({
    id, hostId: 'h1', projectId, projectName: 'glot.it', name,
    config: { paused: false, concurrency: 1, model: null, mode, stop_at: null, drain: false, prune_own: false },
    status: {}, lastSeenAt: '2026-10-27T11:59:00Z', active: [], queue: [], recent: [], counts7d: { runs: 0, prs: 0, noChange: 0, timeouts: 0, errors: 0, infra: 0 },
  })
  const lanesData = (lanes: unknown[]) => ({
    generatedAt: '2026-10-27T12:00:00Z',
    projects: [],
    hosts: [{ id: 'h1', hostname: 'alienware', platform: 'wsl2', version: null, online: true, lastHeartbeatAt: '2026-10-27T11:59:00Z', status: {}, guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, revoked: false, mine: true }],
    lanes,
  })

  it('offers only your fix and skill lanes for the app, and sends the one picked', async () => {
    mocks.lanes = lanesData([lane('l-skill', 'glot-skill', 'skill'), lane('l-audit', 'glot-audit', 'audit'), lane('l-other', 'lets', 'fix', LETS)])
    await render(`/credits?project=${GLOT}`)
    const runOn = host.querySelector('[data-testid="skill-run-on"]') as HTMLSelectElement
    expect(Array.from(runOn.options).map((o) => o.value)).toEqual(['', 'l-skill'])
    const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setSelect.call(runOn, 'l-skill')
      runOn.dispatchEvent(new Event('change', { bubbles: true }))
      const scope = host.querySelector('input') as HTMLInputElement
      setInput.call(scope, 'the /settings pages')
      scope.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const startBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Start skill run')!
    await act(async () => {
      startBtn.click()
      await Promise.resolve()
    })
    expect(mocks.startSkillRun).toHaveBeenCalledWith(GLOT, { skillSlug: 'audit-accessibility', scope: 'the /settings pages', rounds: 3, autoMerge: true, laneId: 'l-skill' })
  })

  it('shows no choice without a lane, and runs in the cloud', async () => {
    await render(`/credits?project=${GLOT}`)
    expect(host.querySelector('[data-testid="skill-run-on"]')).toBeNull()
  })
})
