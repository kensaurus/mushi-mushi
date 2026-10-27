/**
 * @vitest-environment jsdom
 *
 * /ci "Your real bill": reads GET /v1/admin/ci/bill for the active app (or
 * every app), shows this month's net large with gross against net in one
 * line, net per repo (free repos say so), the change against the previous
 * period only when the server gives one, the agent PR share as estimated,
 * and, without a bill, exactly how to connect one.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiBill } from '../../lib/ciBillTypes'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as string | null, loading: false, paths: [] as Array<{ path: string | null; scope?: string }>, reload: vi.fn() }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.paths.push({ path, scope: opts.scope })
    return { data: state.data, loading: state.loading, error: state.error, isValidating: false, reload: state.reload, lastFetchedAt: null }
  },
}))

import { CiBillCard } from './CiBillCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function bill(over: Partial<CiBill> = {}): CiBill {
  const byDay = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 8, 28) + i * 86_400_000).toISOString().slice(0, 10)
    return { day, grossUsd: 1, discountUsd: 0.5, netUsd: 0.5 }
  })
  return {
    generatedAt: '2026-10-27T09:00:00Z',
    window: { days: 30, from: '2026-09-28', to: '2026-10-27' },
    previousWindow: { from: '2026-08-29', to: '2026-09-27' },
    provenance: 'measured',
    currency: 'USD',
    available: true,
    repoScoped: false,
    unavailableReason: null,
    owners: [{ owner: 'acme', ownerType: 'User', lastOkAt: '2026-10-27T02:00:00Z', lastAttemptAt: '2026-10-27T02:00:00Z', lastError: null, lastSource: 'api', coveredFrom: '2026-08-01' }],
    month: { label: '2026-10', from: '2026-10-01', grossUsd: 40, discountUsd: 12.5, netUsd: 27.5 },
    totals: { grossUsd: 30, discountUsd: 15, netUsd: 15, minutes: 2500 },
    previousTotals: { grossUsd: 20, discountUsd: 10, netUsd: 10, minutes: 1600 },
    change: { netUsd: 5, netPct: 0.5 },
    windowComplete: true,
    byRepo: [
      { repo: 'acme/app', owner: 'acme', grossUsd: 20, discountUsd: 5, netUsd: 15, minutes: 2000 },
      { repo: 'acme/site', owner: 'acme', grossUsd: 10, discountUsd: 10, netUsd: 0, minutes: 500 },
    ],
    bySku: [{ sku: 'Actions Linux', unit: 'Minutes', quantity: 2500, grossUsd: 30, discountUsd: 15, netUsd: 15 }],
    byDay,
    dataThrough: '2026-10-27',
    agentShare: { provenance: 'estimated', billedMinutes: 2000, agentBilledMinutes: 500, share: 0.25, branches: ['mushi/*'] },
    ...over,
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = bill()
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
    root.render(createElement(CiBillCard, { projectId, scope }))
  })
}

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('CiBillCard', () => {
  it('reads 30 days for the active app, or every app for All apps', async () => {
    await render()
    expect(state.paths[0]).toEqual({ path: '/v1/admin/ci/bill?project_id=p1&days=30', scope: 'project' })
    state.paths = []
    await render('all')
    expect(state.paths[0]).toEqual({ path: '/v1/admin/ci/bill?days=30', scope: 'enumeration' })
  })

  it('shows this month net large, gross against net in one line, the change, and net per repo', async () => {
    await render()
    expect(q('ci-bill-month-net')!.textContent).toBe('$27.50')
    expect(host.textContent).toContain('Charged for Actions in 2026-10 so far. Gross $40.00: public repos and included minutes are free.')
    expect(host.textContent).toContain('From GitHub')
    expect(q('ci-bill-change')!.textContent).toContain('+$5.00 against the 30 days before (+50%)')
    const repos = q('ci-bill-repos')!.textContent!
    expect(repos).toContain('acme/app$15.00')
    expect(repos).toContain('free: gross $10.00')
    expect(host.querySelector('[aria-label="Net Actions charge per day, last 30 days"]')).not.toBeNull()
    expect(q('ci-bill-agent-share')!.textContent).toContain('25%')
    expect(q('ci-bill-agent-share')!.textContent).toContain('estimated')
  })

  it("says when only the caller's projects' repositories are shown", async () => {
    await render()
    expect(q('ci-bill-repo-scoped')).toBeNull()
    state.data = bill({ repoScoped: true })
    await render()
    expect(q('ci-bill-repo-scoped')!.textContent).toContain('Showing the repositories of your projects only')
  })

  it('leaves out the change when the previous period is not fully held', async () => {
    state.data = bill({ change: null, previousTotals: null, windowComplete: false })
    await render()
    expect(q('ci-bill-change')).toBeNull()
    expect(host.textContent).toContain('Mushi holds part of this window so far')
  })

  it('says exactly how to connect a bill when there is none, with the last refusal', async () => {
    state.data = bill({
      available: false,
      unavailableReason: "The GitHub token can't read billing: use a token with billing read access, or run `mushi runner bill --push`.",
      owners: [{ owner: 'acme', ownerType: 'User', lastOkAt: null, lastAttemptAt: '2026-10-27T02:00:00Z', lastError: 'GitHub answered 404.', lastSource: null, coveredFrom: null }],
      agentShare: null,
    })
    await render()
    const box = q('ci-bill-connect')!
    expect(box.textContent).toContain("The GitHub token can't read billing")
    expect(box.textContent).toContain('Plan: read')
    expect(box.textContent).toContain('Administration: read')
    expect(box.textContent).toContain('mushi runner bill --push')
    expect(box.textContent).toContain('acme: GitHub answered 404.')
    expect(q('ci-bill-month-net')).toBeNull()
    expect(q('ci-bill-agent-share')).toBeNull()
  })

  it('renders an error with a retry, and a loading line', async () => {
    state.data = null
    state.error = 'boom'
    await render()
    expect(host.textContent).toContain('boom')
    state.error = null
    state.loading = true
    await render()
    expect(host.textContent).toContain('Reading your GitHub bill')
  })
})
