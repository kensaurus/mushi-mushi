/**
 * @vitest-environment jsdom
 *
 * /ci (Plan 022): renders the overview (queue first, then timeline, stats,
 * map, advice, slow jobs, test machine failures), the one-sentence empty
 * state, the GitHub permissions banner, the queue columns with their counts,
 * hints and fix links, the `?job=` focus, and the All apps scope (the header
 * switcher's choice, lib/projectScope.ts, mirrored by the page toggle).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiOverview } from '../lib/ciTypes'
import { ciOverviewFixture, emptyCiOverview } from '../components/ci/__fixtures__/ciOverview'

const state = vi.hoisted(() => ({
  overview: null as unknown,
  projectId: 'p1' as string | null,
  paths: [] as Array<{ path: string | null; scope?: string }>,
  error: null as unknown,
  summary: '' as string,
  syncs: [] as Array<{ path: string; scope?: string }>,
}))

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { scope?: string } = {}) => {
    state.syncs.push({ path, scope: opts.scope })
    return { ok: true, data: null }
  },
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.paths.push({ path, scope: opts.scope })
    const data = path?.startsWith('/v1/admin/ci/overview')
      ? state.overview
      : path?.startsWith('/v1/admin/fixes')
        ? {
            fixes: [
              { id: 'f1', report_id: 'report-142', pr_url: 'https://github.com/kensaurus/glot.it/pull/142', pr_number: 142 },
              { id: 'f2', report_id: 'report-140', pr_url: 'https://github.com/kensaurus/glot.it/pull/140', pr_number: 140 },
            ],
          }
        : null
    const error = path?.startsWith('/v1/admin/ci/overview') ? state.error : null
    return { data, loading: false, error, isValidating: false, reload: () => {}, lastFetchedAt: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => state.projectId }))
vi.mock('../lib/pageContext', () => ({
  usePublishPageContext: (ctx: { summary: string }) => {
    state.summary = ctx.summary
  },
}))
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
import { getStoredProjectScopeMode, setStoredProjectScopeMode } from '../lib/projectScope'

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
  state.syncs = []
  state.error = null
  state.summary = ''
  window.localStorage.clear()
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
  const headings = () => Array.from(host.querySelectorAll('h2, h3')).map((h) => h.textContent ?? '')
  const hasHeading = (t: string) => headings().some((h) => h.startsWith(t))

  it('opens on Now: the header line, the summary, then the queue and the timeline, and nothing else', async () => {
    await render()
    expect(host.querySelector('h1')!.textContent).toBe('CI runners')
    expect(host.textContent).toContain('Where your tests run, how long they wait, and what slows them down.')
    const order = ['Queue', 'Timeline'].map((t) => headings().findIndex((h) => h.startsWith(t)))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // The summary sits above the queue.
    const summary = q('ci-summary')!
    expect(summary.compareDocumentPosition(q('ci-queue')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // One long column was 50,000 px tall (2026-11-06): the other views are not on Now.
    for (const t of ['Runner map', 'Speed it up', 'Slow jobs', 'Stopped by the test machine', 'Where CI runs']) expect(hasHeading(t)).toBe(false)
  })

  it('puts each section in its view, with a tab per view and the active one marked', async () => {
    const views: Array<[string, string[]]> = [
      ['machines', ['Runner map', 'Stopped by the test machine']],
      ['cost', ['Speed it up', 'Slow jobs', 'Cost and speed']],
      ['settings', ['Where CI runs']],
    ]
    for (const [view, titles] of views) {
      act(() => root.unmount())
      root = createRoot(host)
      await render(`/ci?view=${view}`)
      for (const t of titles) expect(hasHeading(t)).toBe(true)
      expect(q('ci-queue')).toBeNull()
      const active = host.querySelector('[role="tab"][aria-selected="true"]')!
      expect(active.getAttribute('href')).toContain(`view=${view}`)
    }
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent ?? '')
    expect(tabs.map((t) => t.replace(/\d+$/, ''))).toEqual(['Now', 'Machines', 'Speed and cost', 'Settings'])
  })

  it('keeps old section links working: the hash picks the view, then scrolls to it', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll // jsdom has none
    await render('/ci#ci-placement')
    expect(hasHeading('Where CI runs')).toBe(true)
    expect(q('ci-queue')).toBeNull()
    expect(scroll).toHaveBeenCalled()
  })

  it('labels each tab count with what it counts', async () => {
    await render()
    const labels = Array.from(host.querySelectorAll('[role="tab"] [aria-label]')).map((b) => b.getAttribute('aria-label') ?? '')
    expect(labels.some((l) => /jobs? waiting for a test machine$/.test(l))).toBe(true)
    expect(labels.some((l) => /changes? that would speed CI up$/.test(l))).toBe(true)
    expect(labels.every((l) => !l.endsWith(' items'))).toBe(true)
  })

  it('keeps the scope and the job in the tab links', async () => {
    await render('/ci?job=j3')
    const machines = Array.from(host.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.startsWith('Machines'))!
    expect(machines.getAttribute('href')).toMatch(/job=j3/)
    expect(machines.getAttribute('href')).toMatch(/view=machines/)
  })

  it('paints from stored jobs, live-syncs with refresh=1 in the background, and shows when it was updated', async () => {
    await render()
    expect(state.paths.some((p) => p.path === '/v1/admin/ci/overview?project_id=p1&days=7')).toBe(true)
    expect(state.paths.some((p) => p.path?.includes('refresh=1'))).toBe(false)
    expect(state.syncs).toContainEqual({ path: '/v1/admin/ci/overview?project_id=p1&days=7&refresh=1', scope: 'project' })
    expect(state.syncs).toHaveLength(1)
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
    expect(q('ci-queue-job-j2')!.textContent).toContain('30 min so far')
    expect(q('ci-queue-job-j2')!.textContent).toContain('waiting for a machine labelled nuc')
    const fix = Array.from(q('ci-queue-job-j2')!.querySelectorAll('a')).find((a) => a.textContent?.startsWith('Open the fix in Mushi'))
    expect(fix?.getAttribute('href')).toBe('/reports/report-142')
    expect(q('ci-queue-job-j1')!.textContent).toContain('nuc-glot')
    expect(q('ci-queue-job-j1')!.textContent).toContain('8 min so far')
    expect(q('ci-queue-job-j6')!.textContent).toContain('Test machine stopped')
  })

  it('offers Re-run tests only on a job the test machine stopped, and names its links', async () => {
    await render()
    const stopped = q('ci-queue-job-j6')!
    expect(Array.from(stopped.querySelectorAll('button')).some((b) => b.textContent?.includes('Re-run tests'))).toBe(true)
    expect(Array.from(stopped.querySelectorAll('a')).some((a) => a.textContent?.includes('View on GitHub'))).toBe(true)
    const failed = q('ci-queue-job-j7')
    if (failed) {
      expect(Array.from(failed.querySelectorAll('button')).some((b) => b.textContent?.includes('Re-run'))).toBe(false)
      expect(Array.from(failed.querySelectorAll('a')).some((a) => a.textContent?.includes('Read the failing logs'))).toBe(true)
    }
  })

  it('opens with a plain verdict, live tiles and the outcome bar', async () => {
    await render()
    expect(q('ci-verdict')!.textContent).toMatch(/waiting for a test machine|test machine, not your code|failed on the code|healthy/)
    const summary = q('ci-summary')!
    expect(summary.textContent).toContain('Waiting now')
    expect(summary.textContent).toContain('Running now')
    expect(summary.textContent).toContain('Test machine stopped')
    expect(summary.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/passed/)
  })

  it('filters finished jobs by outcome', async () => {
    await render()
    const chip = Array.from(host.querySelectorAll('[aria-label="Show finished jobs"] button')).find((b) => b.textContent?.startsWith('Test machine stopped'))!
    await act(async () => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(q('ci-queue-job-j6')).not.toBeNull()
    expect(q('ci-queue-job-j5')).toBeNull()
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

  it('lists advice with its evidence and a copyable fix under Speed and cost', async () => {
    await render('/ci?view=cost')
    expect(q('ci-advice')!.textContent).toContain('nuc-glot ran out of memory')
    expect(q('ci-advice')!.textContent).toContain('1 OOM kill in 7 days')
    expect(q('ci-advice')!.querySelector('button[aria-label="Copy the fix"]')).not.toBeNull()
  })

  it('shows the map and the infra failures under Machines', async () => {
    await render('/ci?view=machines')
    expect(q('ci-infra-failures')!.textContent).toContain('lost communication')
    expect(q('ci-map-stub')!.textContent).toBe('2 hosts')
  })

  it('shows one advice card per rule, with a chip per workflow and the fix once', async () => {
    const T = 'kensaurus/tsumagoi'
    const drafts = (path: string) => ({
      id: `drafts_not_skipped:${T}:.github/workflows/${path}`,
      severity: 'low' as const,
      title: 'Draft pull requests run the full CI',
      detail: 'Each push runs this workflow before anyone can merge it.',
      evidence: `${T}/.github/workflows/${path} runs on pull_request and never checks the draft flag.`,
      fix: 'Add if: github.event.pull_request.draft == false',
      repo: T,
    })
    const slow = { id: 'slow_steps', severity: 'low' as const, title: 'Where your CI spends its time', detail: 'd', evidence: `${T} · build · pnpm install: 3 min (12 runs); ${T} · e2e · playwright: 9 min (4 runs)`, fix: 'Cache it', repo: T }
    state.overview = ciOverviewFixture({ advice: [drafts('ci-pr.yml'), drafts('pricing-parity.yml'), drafts('mushi-freshness.yml'), slow] })
    await render('/ci?view=cost')
    const advice = q('ci-advice')!
    expect(advice.querySelectorAll(':scope > li')).toHaveLength(2)
    expect(advice.textContent!.match(/Draft pull requests run the full CI/g)).toHaveLength(1)
    for (const file of ['ci-pr.yml', 'pricing-parity.yml', 'mushi-freshness.yml']) expect(advice.textContent).toContain(file)
    expect(advice.querySelectorAll('button[aria-label="Copy the fix"]')).toHaveLength(2)
    // Evidence joined with "; " reads as a list.
    expect([...advice.querySelectorAll('ul.list-disc li')].map((li) => li.textContent)).toEqual(expect.arrayContaining([`${T} · e2e · playwright: 9 min (4 runs)`]))
  })

  it('shows slow jobs and steps in full, with the repo name and a bar against the slowest', async () => {
    await render('/ci?view=cost')
    const jobs = q('ci-slow-jobs')!
    expect(jobs.textContent).toContain('build')
    expect(jobs.textContent).toContain('CI')
    expect(jobs.textContent).toMatch(/glot\.it · PR #\d+/)
    expect(jobs.textContent).not.toContain('kensaurus/')
    expect(jobs.querySelector('[role="meter"]')!.getAttribute('aria-label')).toBe('build ran 15 min')
    const steps = q('ci-slow-steps')!
    expect(steps.textContent).toContain('pnpm install')
    expect(steps.textContent).toContain('build · glot.it')
  })

  it('shows one sentence and one action when there is nothing yet', async () => {
    state.overview = emptyCiOverview()
    await render()
    expect(host.textContent).toContain('No CI jobs seen yet')
    expect(host.textContent).toContain('mushi runner key')
    expect(host.textContent).toContain('mushi runner hooks install --dir <runner dir>')
    expect(host.textContent).not.toContain('mushi runner heartbeat')
    expect(q('ci-queue')).toBeNull()
    expect(host.textContent).not.toContain('Pass rate')
    const action = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'How to set up CI runners')
    expect(action?.getAttribute('href')).toMatch(/\/operating\/ci-runners$/)
  })

  it('explains a missing runner permission where the runners are, not on top of Now', async () => {
    const text = 'Mushi sees runners only through jobs. Give the GitHub token Administration: read to see idle and offline runners.'
    state.overview = ciOverviewFixture({ permissions: { jobs: 'ok', runners: 'missing' } })
    await render('/ci?view=machines')
    expect(host.textContent).toContain(text)
    act(() => root.unmount())
    root = createRoot(host)
    await render()
    expect(host.textContent).not.toContain(text)
  })

  it('explains a missing jobs permission on every view, Now included', async () => {
    state.overview = ciOverviewFixture({ permissions: { jobs: 'missing', runners: 'unknown' } })
    await render()
    expect(host.textContent).toContain('Give the GitHub token Actions: read')
  })

  it('reads every app without a project_id when no project is active', async () => {
    state.projectId = null
    await render()
    expect(state.paths).toContainEqual({ path: '/v1/admin/ci/overview?days=7', scope: 'enumeration' })
  })

  it('reads every app when the header says All apps, without the fix links', async () => {
    await render('/ci?apps=all')
    expect(state.paths).toContainEqual({ path: '/v1/admin/ci/overview?days=7', scope: 'enumeration' })
    expect(state.paths.some((p) => p.path?.includes('project_id='))).toBe(false)
    expect(state.paths.filter((p) => p.path?.startsWith('/v1/admin/fixes'))).toEqual([])
  })

  it('reads every app when All apps is the stored choice', async () => {
    setStoredProjectScopeMode('all')
    await render('/ci')
    expect(state.paths).toContainEqual({ path: '/v1/admin/ci/overview?days=7', scope: 'enumeration' })
  })

  it('its toggle switches the header scope back to this app', async () => {
    await render('/ci?apps=all')
    const thisApp = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'This app') as HTMLButtonElement
    state.paths = []
    await act(async () => thisApp.click())
    expect(getStoredProjectScopeMode()).toBe('project')
    expect(state.paths).toContainEqual({ path: '/v1/admin/ci/overview?project_id=p1&days=7', scope: 'project' })
    expect(state.paths).not.toContainEqual({ path: '/v1/admin/ci/overview?days=7', scope: 'enumeration' })
  })

  it('offers the apps to pick on Settings with All apps, and picking one switches to that app', async () => {
    // "Pick one app to see and change where its CI runs." with nothing to pick was a dead end, and the
    // first fix made two URL updates in one click, so picking glot.it opened the old app (yen-yen).
    const base = ciOverviewFixture()
    state.overview = { ...base, repos: [...base.repos, { ...base.repos[0], projectId: 'p2', projectName: 'yen-yen', repo: 'acme/yen-yen' }] }
    let search = ''
    const Probe = () => {
      search = useLocation().search
      return null
    }
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/ci?apps=all&view=settings&project=p1'] }, createElement(CiPage), createElement(Probe)))
    })
    const picker = host.querySelector('[data-testid="ci-placement-app-picker"]') as HTMLElement
    expect(Array.from(picker.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['glot.it', 'yen-yen'])
    const yen = Array.from(picker.querySelectorAll('button')).find((b) => b.textContent === 'yen-yen') as HTMLButtonElement
    await act(async () => yen.click())
    const params = new URLSearchParams(search)
    expect(params.get('project')).toBe('p2')
    expect(params.get('apps')).toBeNull()
    expect(params.get('view')).toBe('settings')
    expect(getStoredProjectScopeMode()).toBe('project')
  })

  it('says the page could not load, not that it is still loading, when the overview fails', async () => {
    state.overview = null
    state.error = 'HTTP_ERROR: 404 Not Found'
    await render()
    expect(state.summary).toBe("CI runners couldn't load")
  })
})
