/**
 * @vitest-environment jsdom
 *
 * The /releases "Batch" tab (console ops plan 2026-10-27, P1): one card per
 * repo with the open or next train, each member's verdict, CI and why it
 * rides or waits, the rules with their counts, migration files (listed,
 * never run; an unread change says the list may be incomplete), the deploy
 * after the last train with a link to the setup gap, failed reads named,
 * and empty, loading and error states.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseBatchResponse, RepoBatch } from '../../lib/releaseBatch'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as string | null, loading: false, paths: [] as Array<{ path: string | null; scope?: string }>, reload: vi.fn() }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null, opts: { scope?: string } = {}) => {
    state.paths.push({ path, scope: opts.scope })
    return { data: state.data, loading: state.loading, error: state.error, isValidating: false, reload: state.reload, lastFetchedAt: null }
  },
}))

import { ReleaseBatchTab } from './ReleaseBatchTab'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const P = '1000000a-0000-4000-8000-000000000000'

function repoFixture(over: Partial<RepoBatch> = {}): RepoBatch {
  return {
    projectId: P,
    projectName: 'glot.it',
    repo: 'kensaurus/glot.it',
    mode: 'train',
    train: { kind: 'next', prNumber: null, state: null, attempt: 1, detail: null, createdAt: null, ci: 'unknown', ciFailing: [], leavesAt: '2026-10-27T14:00:00Z', readyCount: 1, maxMembers: 15, intervalMinutes: 360 },
    members: [
      { fixAttemptId: 'a1', prNumber: 101, prUrl: 'https://github.com/kensaurus/glot.it/pull/101', title: 'Quiz crashes on submit', headSha: 'h1', verdict: 'merge', verdictAtHead: true, ci: 'green', ciFailing: [], draft: false, express: false, benched: null, rides: true, why: 'Ready: it rides the next train.', queueDetail: 'Approved; waits for the next release train.' },
      { fixAttemptId: 'a2', prNumber: 102, prUrl: null, title: null, headSha: 'h2', verdict: 'merge', verdictAtHead: false, ci: 'failing', ciFailing: ['test'], draft: false, express: false, benched: null, rides: false, why: 'Opus approved an older commit (abc1234); it is reviewed again at h2 first.', queueDetail: null },
    ],
    gates: [
      { id: 'approved_at_head', label: 'Opus said merge at its current commit, and nothing holds it', passed: 1, total: 2 },
      { id: 'ci_green', label: 'Its own CI is green', passed: 1, total: 2 },
    ],
    migrations: { source: 'default', globs: ['supabase/migrations/**'], files: [{ prNumber: 101, path: 'supabase/migrations/20261027_add_col.sql' }], complete: false, unread: [102] },
    deploy: { state: 'not_seen', train: { prNumber: 90, mergedAt: '2026-10-26T12:00:00Z', mergeSha: 'abc' }, seenAt: null, version: null, setupGapHref: '/onboarding#setup-gaps' },
    ...over,
  }
}
const response = (repos: RepoBatch[], partial: string[] = []): ReleaseBatchResponse => ({ generatedAt: '2026-10-27T12:00:00Z', repos, partial })

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = response([repoFixture()])
  state.error = null
  state.loading = false
  state.paths = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(projectId: string | null = P) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ReleaseBatchTab, { projectId })))
  })
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('ReleaseBatchTab', () => {
  it('reads the active app, or every app when none is picked', async () => {
    await render()
    expect(state.paths[0]).toEqual({ path: `/v1/admin/release-batch?projectId=${P}`, scope: 'project' })
    state.paths = []
    await render(null)
    expect(state.paths[0]).toEqual({ path: '/v1/admin/release-batch', scope: 'enumeration' })
  })

  it('leads with one sentence and says the batch changes the database', async () => {
    await render()
    expect(q('batch-status')!.textContent).toContain('1 fix ready for the next train, 1 fix waiting. The batch changes the database (1 migration file); Mushi does not run them.')
  })

  it('each member shows rides or waits, the verdict at its commit, CI and why', async () => {
    await render()
    const m1 = q('batch-member-101')!
    expect(m1.dataset.rides).toBe('yes')
    expect(m1.textContent).toContain('Opus: merge')
    expect(m1.textContent).toContain('CI green')
    expect(m1.textContent).toContain('Merge queue: Approved; waits for the next release train.')
    expect(m1.querySelector('a')!.getAttribute('href')).toBe('https://github.com/kensaurus/glot.it/pull/101')
    const m2 = q('batch-member-102')!
    expect(m2.textContent).toContain('Waits')
    expect(m2.textContent).toContain('Opus: merge (older commit)')
    expect(m2.textContent).toContain('CI failing')
    expect(m2.textContent).toContain('Untitled fix')
  })

  it('shows the rules with counts, migrations listed and the list marked incomplete', async () => {
    await render()
    expect(q('batch-gates')!.textContent).toContain('1/2Its own CI is green')
    const mig = q('batch-migrations')!
    expect(mig.textContent).toContain('supabase/migrations/20261027_add_col.sql')
    expect(mig.textContent).toContain('Mushi does not run them')
    expect(mig.textContent).toMatch(/could not read the changes of #\d+, so this list may be incomplete/)
  })

  it('the deploy after the last train links to the setup gap when nothing was seen in 14 days', async () => {
    await render()
    const d = q('batch-deploy')!
    expect(d.textContent).toContain('No deploy seen since the merge yet.')
    expect(d.querySelector('a')!.getAttribute('href')).toBe('/onboarding#setup-gaps')
  })

  it('an open train, release mode "each", and failed reads each say so', async () => {
    state.data = response(
      [
        repoFixture({ train: { ...repoFixture().train, kind: 'open', prNumber: 88, state: 'testing', ci: 'pending', leavesAt: null } }),
        repoFixture({ repo: 'kensaurus/yen-yen', projectId: 'p2', projectName: 'yen-yen', mode: 'each', members: [] }),
      ],
      ['ci'],
    )
    await render(null)
    expect(q('batch-repo-kensaurus/glot.it')!.textContent).toContain('is running CI with 1 fix')
    expect(q('batch-repo-kensaurus/glot.it')!.textContent).toContain('CI running')
    expect(q('batch-repo-kensaurus/yen-yen')!.textContent).toContain('merges each fix on its own')
    expect(q('batch-repo-kensaurus/yen-yen')!.textContent).toContain('yen-yen')
    expect(q('batch-partial')!.textContent).toContain('Mushi could not read CI results')
  })

  it('empty, loading and error states', async () => {
    state.data = response([])
    await render()
    expect(q('batch-empty')!.textContent).toContain('No repo to batch yet')
    state.data = null
    state.loading = true
    await render()
    expect(host.textContent).toContain('Reading the release trains…')
    state.loading = false
    state.error = 'Network error'
    await render()
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Network error')
  })
})
