/**
 * @vitest-environment jsdom
 *
 * /ci (Plan 022): renders the overview (queue first, then timeline, stats,
 * map, advice, slow jobs, test machine failures), the one-sentence empty
 * state, the GitHub permissions banner, the queue columns with their counts,
 * hints and fix links, the `?job=` focus, and the All apps scope.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiOverview } from '../lib/ciTypes'
import { ciOverviewFixture, emptyCiOverview } from '../components/ci/__fixtures__/ciOverview'

const state = vi.hoisted(() => ({
  overview: null as unknown,
  projectId: 'p1' as string | null,
  paths: [] as Array<{ path: string | null; scope?: string }>,
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.paths.push({ path, scope: opts.scope })
    const data = path?.startsWith('/v1/admin/ci/overview')
      ? state.overview
      : path?.startsWith('/v1/admin/fixes')
        ? { fixes: [{ id: 'f1', report_id: 'report-142', pr_url: 'https://github.com/kensaurus/glot.it/pull/142', pr_number: 142 }] }
        : null
    return { data, loading: false, error: null, isValidating: false, reload: () => {}, lastFetchedAt: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => state.projectId }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeaderBar: ({ title, description, children }: { title: string; description?: string; children?: unknown }) =>
      h('header', null, h('h1', null, title), h('p', null, description), children as never),
  }
})
vi.mock('../components/ci/CiRunnerMap', async () => {
  const { createElement: h } = await import('react')
  return { CiRunnerMap: ({ overview }: { overview: CiOverview }) => h('div', { 'data-testid': 'ci-map-stub' }, `${overview.hosts.length} hosts`) }
})

import { CiPage } from './CiPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.overview = ciOverviewFixture()
  state.projectId = 'p1'
  state.paths = []
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function render(url = '/ci') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(CiPage)))
  })
  // Let the lazy map resolve.
  await act(async () => {
    await Promise.resolve()
  })
}

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('CiPage', () => {
  it('renders the header line and every section, queue first', async () => {
    await render()
    expect(host.querySelector('h1')!.textContent).toBe('CI runners')
    expect(host.textContent).toContain('Where your tests run, how long they wait, and what slows them down.')
    const headings = Array.from(host.querySelectorAll('h2, h3')).map((h) => h.textContent ?? '')
    const order = ['Queue', 'Timeline', 'Runner map', 'Speed it up', 'Slow jobs', 'Test machine failures'].map((t) =>
      headings.findIndex((h) => h.startsWith(t)),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(host.textContent).toContain('Machine vs code failures')
    expect(host.textContent).toContain('6 / 9')
  })

  it('polls the project overview with refresh=1 and shows when it was updated', async () => {
    await render()
    expect(state.paths.some((p) => p.path === '/v1/admin/ci/overview?project_id=p1&days=7&refresh=1')).toBe(true)
    expect(q('ci-updated-ago')!.textContent).toBe('Updated 20 s ago')
  })

  it('lays out the queue: waiting oldest first with counts, hints and fix links', async () => {
    await render()
    expect(q('ci-queue-count-waiting')!.textContent).toBe('3')
    expect(q('ci-queue-count-running')!.textContent).toBe('1')
    expect(q('ci-queue-count-finished')!.textContent).toBe('4')
    const waiting = Array.from(host.querySelectorAll('[data-testid^="ci-queue-job-"]'))
      .map((el) => el.getAttribute('data-testid'))
      .slice(0, 3)
    expect(waiting).toEqual(['ci-queue-job-j2', 'ci-queue-job-j3', 'ci-queue-job-j4'])
    expect(q('ci-queue-job-j2')!.textContent).toContain('waiting 30 min')
    expect(q('ci-queue-job-j2')!.textContent).toContain('waiting for a machine labelled nuc')
    const fix = Array.from(q('ci-queue-job-j2')!.querySelectorAll('a')).find((a) => a.textContent?.startsWith('Mushi fix'))
    expect(fix?.getAttribute('href')).toBe('/reports/report-142')
    expect(q('ci-queue-job-j1')!.textContent).toContain('on nuc-glot · 8 min')
    expect(q('ci-queue-job-j6')!.textContent).toContain('Test machine stopped')
  })

  it('focuses the job named in ?job=', async () => {
    await render('/ci?job=j3')
    expect(q('ci-queue-job-j3')!.dataset.focused).toBe('true')
    expect(q('ci-queue-job-j2')!.dataset.focused).toBeUndefined()
  })

  it('draws the timeline with the busiest runner first and "No runner yet" last', async () => {
    await render()
    const lanes = Array.from(host.querySelectorAll('[data-testid^="ci-timeline-lane-"]')).map((el) => el.getAttribute('data-testid'))
    expect(lanes[0]).toBe('ci-timeline-lane-nuc-glot')
    expect(lanes.at(-1)).toBe('ci-timeline-lane-No runner yet')
    const bar = q('ci-timeline-bar-j6')!
    expect(bar.getAttribute('aria-label')).toContain('Test machine stopped')
    expect(bar.getAttribute('aria-label')).toContain('memory peak 9.9 GB')
  })

  it('lists advice with its evidence and a copyable fix, and the infra failures', async () => {
    await render()
    expect(q('ci-advice')!.textContent).toContain('nuc-glot ran out of memory')
    expect(q('ci-advice')!.textContent).toContain('1 OOM kill in 7 days')
    expect(q('ci-advice')!.querySelector('button[aria-label="Copy the fix"]')).not.toBeNull()
    expect(q('ci-infra-failures')!.textContent).toContain('lost communication')
    expect(q('ci-map-stub')!.textContent).toBe('2 hosts')
  })

  it('shows one sentence and one action when there is nothing yet', async () => {
    state.overview = emptyCiOverview()
    await render()
    expect(host.textContent).toContain('No CI jobs seen yet')
    expect(q('ci-queue')).toBeNull()
    expect(host.textContent).not.toContain('Pass rate')
    const action = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'How to set up CI runners')
    expect(action?.getAttribute('href')).toMatch(/\/operating\/ci-runners$/)
  })

  it('explains a missing runner permission', async () => {
    state.overview = ciOverviewFixture({ permissions: { jobs: 'ok', runners: 'missing' } })
    await render()
    expect(host.textContent).toContain(
      'Mushi sees runners only through jobs. Give the GitHub token Administration: read to see idle and offline runners.',
    )
  })

  it('explains a missing jobs permission', async () => {
    state.overview = ciOverviewFixture({ permissions: { jobs: 'missing', runners: 'unknown' } })
    await render()
    expect(host.textContent).toContain('Give the GitHub token Actions: read')
  })

  it('reads every app without a project_id when no project is active', async () => {
    state.projectId = null
    await render()
    expect(state.paths).toContainEqual({ path: '/v1/admin/ci/overview?days=7&refresh=1', scope: 'enumeration' })
  })
})
