/**
 * @vitest-environment jsdom
 *
 * The report page names the failing checks of its fix PR and offers the same
 * actions /pipeline does, disabled with the server's reason when they would
 * be refused (reports 9e2ec6f0, 69fcafcb).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  view: null as unknown,
  posts: [] as Array<{ path: string; body: unknown }>,
}))

vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { body?: string } = {}) => {
    if (path.startsWith('/v1/admin/pipeline/fix/')) return { ok: true, data: state.view }
    state.posts.push({ path, body: opts.body ? JSON.parse(opts.body) : null })
    return { ok: true, data: { results: [{ id: 'f1', ok: true, message: 'GitHub is merging the base branch into it; CI runs again on the new commit.' }] } }
  },
}))

import { ReportFixActions } from './ReportFixActions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RERUN_OFF = 'The GitHub token cannot re-run workflows: give it Actions: Read and write (fine-grained token) or the workflow scope, in the GitHub connection.'

function view(over: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-10-27T00:00:00Z',
    stage: 'ci',
    groupId: 'ci_red',
    groupLabel: '1 PR: their own CI is red',
    tone: 'stuck',
    actions: ['ci_repair', 'rerun_ci', 'update_branch', 'close'],
    item: {
      id: 'f1',
      projectId: 'p1',
      reportId: 'r1',
      title: 'Home lesson rail crashes',
      repo: 'kensaurus/yen-yen',
      prNumber: 364,
      prUrl: 'https://github.com/kensaurus/yen-yen/pull/364',
      queueId: null,
      since: '2026-10-26T00:00:00Z',
      lastError: null,
      lastEventAt: null,
      lastEventLabel: null,
      failingChecks: ['Lint, typecheck, build, doctor'],
      review: null,
      queueDetail: null,
      blocked: { rerun_ci: RERUN_OFF },
    },
    ...over,
  }
}

let root: Root
let host: HTMLDivElement
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.posts = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ReportFixActions, { fixId: 'f1' })))
  })
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('ReportFixActions', () => {
  it('names the failing check whole and says where the fix is stuck', async () => {
    state.view = view()
    await render()
    expect(q('report-fix-actions')!.textContent).toContain('Stuck: their own CI is red')
    const checks = q('report-fix-failing-checks')!
    expect(checks.textContent).toContain('Lint, typecheck, build, doctor')
    expect(checks.querySelectorAll('span[class]').length).toBeGreaterThanOrEqual(1)
  })

  it('disables Re-run CI with the server reason and keeps the actions that can work', async () => {
    state.view = view()
    await render()
    expect((q('report-fix-rerun_ci') as HTMLButtonElement).disabled).toBe(true)
    expect(q('report-fix-blocked')!.textContent).toContain('Re-run CI is off: The GitHub token cannot re-run workflows')
    expect((q('report-fix-update_branch') as HTMLButtonElement).disabled).toBe(false)
  })

  it('runs an action after the confirm and shows its result', async () => {
    state.view = view()
    await render()
    await act(async () => q('report-fix-update_branch')!.click())
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Update branch' && b.hasAttribute('data-primary'))!
    await act(async () => confirm.click())
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    expect(state.posts[0]).toEqual({ path: '/v1/admin/pipeline/actions', body: { action: 'update_branch', fixIds: ['f1'] } })
    expect(q('report-fix-actions')!.textContent).toContain('CI runs again on the new commit')
  })

  it('renders nothing when the fix sits in no pipeline group', async () => {
    state.view = view({ groupLabel: null, item: null, actions: [] })
    await render()
    expect(q('report-fix-actions')).toBeNull()
  })
})
