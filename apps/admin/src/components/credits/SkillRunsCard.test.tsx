/**
 * @vitest-environment jsdom
 *
 * The skill-run app picker on /credits starts on the open app — the one the
 * "one app at a time" notice names — from ?project= or the stored app. Every
 * other app stays choosable, and runs from the whole team stay listed.
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
}))

vi.mock('../../lib/skillRuns', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, loadSkillRuns: mocks.loadSkillRuns }
})

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
