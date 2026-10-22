/**
 * @vitest-environment jsdom
 *
 * /ci "Cost and speed" (Plan 022 Phase 7, ADR 0037): reads the compare route
 * for the active app (or every app), labels every column measured or
 * estimated, shows each repo's visibility, the included minutes per GitHub
 * account, your machines, speed with its sample sizes ("not measured" below
 * 5 runs), what-ifs with the jobs that stay and the warnings, the "why it
 * costs" rules, and cost advice; thin data and example figures are called
 * out; errors and empty windows render, never a blank.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ciCompareFixture, costSettingsFixture } from './__fixtures__/ciCompare'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as string | null, loading: false, paths: [] as Array<{ path: string | null; scope?: string }>, reload: vi.fn() }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.paths.push({ path, scope: opts.scope })
    return { data: state.data, loading: state.loading, error: state.error, isValidating: false, reload: state.reload, lastFetchedAt: null }
  },
}))

import { CiCostSection } from './CiCostSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = ciCompareFixture()
  state.error = null
  state.loading = false
  state.paths = []
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(scope: 'project' | 'all' = 'project', projectId: string | null = 'p1') {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CiCostSection, { projectId, scope })))
  })
}

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('CiCostSection', () => {
  it('reads 30 days for the active app, or every app for All apps', async () => {
    await render()
    expect(state.paths[0]).toEqual({ path: '/v1/admin/ci/compare?project_id=p1&days=30', scope: 'project' })
    state.paths = []
    await render('all')
    expect(state.paths[0]).toEqual({ path: '/v1/admin/ci/compare?days=30', scope: 'enumeration' })
  })

  it('labels every column measured or estimated and says where money comes from', async () => {
    await render()
    const head = q('ci-compare-table')!.querySelector('thead')!.textContent!
    expect(head).toContain('Wait p95measured')
    expect(head).toContain('Run time p50measured')
    expect(head).toContain('PR pass ratemeasured')
    expect(head).toContain('Minutes billedestimated')
    expect(head).toContain('Per monthestimated')
    expect(host.textContent).toContain('Wait and run times are measured; minutes billed and money are estimated from GitHub’s list prices (read 2026-10-22)')
  })

  it('groups rows by repo with its visibility, most expensive first, and says why each cost is what it is', async () => {
    await render()
    const table = q('ci-compare-table')!
    const repos = Array.from(table.querySelectorAll('th[scope="rowgroup"]')).map((th) => th.textContent)
    expect(repos[0]).toContain('kensaurus/tsumagoi')
    expect(repos[0]).toContain('Private')
    expect(repos.find((r) => r?.includes('mushi-mushi'))).toContain('Public')
    expect(repos.find((r) => r?.includes('glot.it'))).toContain('Not checked')
    const hosted = q('ci-compare-row-a')!.textContent!
    expect(hosted).toContain('GitHub-hosted')
    expect(hosted).toContain('91%')
    expect(hosted).toContain('1,387 min')
    expect(hosted).toContain('$61.37')
    expect(q('ci-compare-row-b')!.textContent).toContain('Your machine: Alienware')
    expect(q('ci-compare-row-c')!.textContent).toContain('Free')
    expect(q('ci-compare-row-d')!.textContent).toContain('Never picked up')
    expect(q('ci-compare-row-d')!.textContent).toContain('202 expired after 24 h unpicked')
    // Phones get the same figures as a list.
    expect(q('ci-compare-cards')!.textContent).toContain('Minutes billed (estimated)')
  })

  it('shows included minutes per account, machines, and speed with sample sizes', async () => {
    await render()
    expect(q('ci-cost-accounts')!.textContent).toContain('$128.11a month, estimated')
    expect(q('ci-cost-accounts')!.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('100')
    expect(q('ci-cost-machines')!.textContent).toContain('busy 14.2 h (26%)')
    expect(q('ci-cost-machines')!.textContent).toContain('150 W extra under load')
    expect(q('ci-cost-speed')!.textContent).toContain('0.55×')
    expect(q('ci-cost-speed')!.textContent).toContain('(10 and 10 runs)')
    expect(host.textContent).toContain('1 more job ran on both, with too few passed runs to measure.')
  })

  it('shows what-ifs with the jobs that stay, the speed and the warnings', async () => {
    await render()
    const w = q('ci-cost-whatifs')!.textContent!
    expect(w).toContain('Move CI in kensaurus/tsumagoi to Alienware')
    expect(w).toContain('−$54.10')
    expect(w).toContain('Speed: 0.55× measured (10 and 10 runs)')
    expect(w).toContain('busy 26% → 74%')
    expect(w).toContain('Stays: Mobile perf gate')
    expect(w).toContain('Alienware would be busy 74% of the time')
  })

  it('calls out thin data and example figures, linking to Settings → CI cost', async () => {
    await render()
    expect(host.textContent).toContain('Only 2.3 days of job data so far')
    const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('Settings → CI cost'))!
    expect(link.getAttribute('href')).toBe('/settings?tab=ci-cost')
    state.data = ciCompareFixture({ lowConfidence: false, settings: [costSettingsFixture({ source: 'yours' })], sourceNote: 'Based on the newest 10,000 of 12,000 jobs.' })
    await render()
    expect(host.textContent).not.toContain('days of job data so far')
    expect(host.querySelector('a[href="/settings?tab=ci-cost"]')).toBeNull()
    expect(host.textContent).toContain('Based on the newest 10,000 of 12,000 jobs.')
  })

  it('explains why it costs what it costs, rules that apply first and open', async () => {
    await render()
    const ex = q('ci-cost-explainer')!
    expect(q('ci-cost-fact-public_free')).not.toBeNull()
    expect(q('ci-cost-fact-pinned')!.textContent).toContain('“TBT budgets failed every PR on the shared machine”')
    expect(q('ci-cost-fact-always_hosted')!.textContent).toContain('main and Dependabot')
    // Standing rules sit in a native disclosure (keyboard reachable).
    const details = ex.querySelector('details')!
    expect(details.querySelector('summary')!.textContent).toMatch(/The other \d+ rules GitHub bills by/)
    expect(details.textContent).toContain('2 CPUs and 8 GB on a private repository')
    expect(host.textContent).toContain('kensaurus/yen-yen has no LINUX_RUNNER variable')
  })

  it('renders an error with retry, a loading line, and an empty window', async () => {
    state.data = null
    state.error = 'The CI cost comparison could not be read.'
    await render()
    expect(host.textContent).toContain('The CI cost comparison could not be read.')
    state.error = null
    state.loading = true
    await render()
    expect(host.textContent).toContain('Working out what CI costs')
    state.loading = false
    state.data = ciCompareFixture({ rows: [], accounts: [], machines: [], speed: [], whatIfs: [], advice: [] })
    await render()
    expect(host.textContent).toContain('No CI jobs in this window')
  })
})
