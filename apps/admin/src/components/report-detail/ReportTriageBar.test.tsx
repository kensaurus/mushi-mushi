/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/ReportTriageBar.test.tsx
 * PURPOSE: The "Repo" select beside Dispatch fix shows only for a project
 *          with more than one linked repo, starts on the primary, and the
 *          confirm names the repo the PR will open against. The confirm is
 *          the page's (useConfirmedDispatch), shared with the recommendation
 *          card, so the harness renders the bar with that hook. "Sync to N
 *          destinations" counts the server's syncDestinations (#84).
 */

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchTargetRepo } from '../../lib/useDispatchTargetRepo'

type LinkedRepo = DispatchTargetRepo['repos'][number]
import type { ReportDetail } from './types'

const { pageData, apiFetch, toast } = vi.hoisted(() => ({
  pageData: { current: { integrations: [] as unknown[], syncDestinations: undefined as string[] | undefined } },
  apiFetch: vi.fn(),
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), push: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../lib/usePageData', () => ({ usePageData: () => ({ data: pageData.current }) }))
vi.mock('../../lib/supabase', () => ({ apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { ReportTriageBar } from './ReportTriageBar'
import { useConfirmedDispatch } from './useConfirmedDispatch'
import type { PreflightState } from '../../lib/useDispatchPreflight'

const FRONTEND: LinkedRepo = { id: 'repo-front', repo_url: 'https://github.com/acme/solo-boss-cloud', default_branch: 'main', is_primary: true }
const BACKEND: LinkedRepo = { id: 'repo-back', repo_url: 'https://github.com/acme/solo-boss-cloud_backend', default_branch: 'develop', is_primary: false }

const REPORT = { id: 'report-1', project_id: 'project-1', status: 'classified', severity: 'high' } as unknown as ReportDetail

function choice(repos: LinkedRepo[], targetRepoId: string, setTargetRepoId = vi.fn()): DispatchTargetRepo {
  return {
    repos,
    targetRepoId,
    setTargetRepoId,
    target: repos.find((r) => r.id === targetRepoId) ?? null,
    dispatchTargetRepoId: repos.length > 1 && targetRepoId ? targetRepoId : undefined,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  pageData.current = { integrations: [], syncDestinations: undefined }
  apiFetch.mockReset()
  toast.info.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** The bar as the page mounts it: gate + confirm from useConfirmedDispatch. */
function Harness(props: {
  repoChoice: DispatchTargetRepo
  onDispatch: () => void
  report?: ReportDetail
  preflight?: PreflightState
}) {
  const report = props.report ?? REPORT
  const confirmed = useConfirmedDispatch({
    report,
    preflight: props.preflight,
    repoChoice: props.repoChoice,
    busy: false,
    dispatch: props.onDispatch,
  })
  return createElement(
    'div',
    null,
    createElement(ReportTriageBar, {
      report,
      onTriage: vi.fn(async () => {}),
      saving: false,
      savedAt: null,
      dispatchState: { status: 'idle' },
      onRequestDispatch: confirmed.request,
      dispatchBlock: confirmed.block,
      isDispatchBusy: false,
      repoChoice: props.repoChoice,
    }),
    confirmed.dialog,
  )
}

async function render(
  repoChoice: DispatchTargetRepo,
  onDispatch = vi.fn(),
  extra: { report?: ReportDetail; preflight?: PreflightState } = {},
): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { repoChoice, onDispatch, ...extra }))
  })
}

function repoSelect(): HTMLSelectElement | null {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent?.startsWith('Repo'))
  return label?.querySelector('select') ?? null
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text)
}

describe('ReportTriageBar Repo select', () => {
  it('is hidden for a project with one linked repo', async () => {
    await render(choice([FRONTEND], 'repo-front'))
    expect(repoSelect()).toBeNull()
  })

  it('lists every linked repo, starts on the primary, and reports a change', async () => {
    const setTargetRepoId = vi.fn()
    await render(choice([FRONTEND, BACKEND], 'repo-front', setTargetRepoId))
    const select = repoSelect()
    expect(select).not.toBeNull()
    expect(select!.value).toBe('repo-front')
    expect(Array.from(select!.options).map((o) => o.textContent)).toEqual([
      'acme/solo-boss-cloud (primary)',
      'acme/solo-boss-cloud_backend',
    ])
    await act(async () => {
      select!.value = 'repo-back'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setTargetRepoId).toHaveBeenCalledWith('repo-back')
  })

  it('names the chosen repo and its base branch in the confirm, then dispatches', async () => {
    const onDispatch = vi.fn()
    await render(choice([FRONTEND, BACKEND], 'repo-back'), onDispatch)
    await act(async () => buttonByText('Dispatch fix')?.click())
    const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')
    expect(dialog?.textContent).toContain('acme/solo-boss-cloud_backend')
    expect(dialog?.textContent).toContain('the develop branch')
    const confirm = Array.from(dialog!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Dispatch fix')
    await act(async () => confirm?.click())
    expect(onDispatch).toHaveBeenCalledTimes(1)
  })
})

describe('ReportTriageBar dispatch gate (#19)', () => {
  it('is disabled with the reason when preflight fails, and never dispatches', async () => {
    const onDispatch = vi.fn()
    await render(choice([FRONTEND], 'repo-front'), onDispatch, {
      preflight: {
        loading: false,
        ready: false,
        checks: [],
        failing: [{ key: 'autofix', label: 'Autofix enabled', ready: false }],
        error: null,
        repoUrl: null,
        baseBranch: null,
      } as unknown as PreflightState,
    })
    const btn = buttonByText('Dispatch fix')
    expect(btn?.disabled).toBe(true)
    expect(btn?.title).toBe('Set up first: Autofix enabled.')
    expect(onDispatch).not.toHaveBeenCalled()
  })

  it('cancel in the confirm sends nothing', async () => {
    const onDispatch = vi.fn()
    await render(choice([FRONTEND], 'repo-front'), onDispatch)
    await act(async () => buttonByText('Dispatch fix')?.click())
    await act(async () => buttonByText('Cancel')?.click())
    expect(onDispatch).not.toHaveBeenCalled()
  })
})

describe('Sync to destinations (#84)', () => {
  it('counts Linear connected from the console (no routing row)', async () => {
    pageData.current = { integrations: [], syncDestinations: ['linear'] }
    await render(choice([FRONTEND], 'repo-front'))
    expect(buttonByText('Sync to 1 destination')).toBeDefined()
  })

  it('calls the server instead of stopping at "none active"', async () => {
    pageData.current = { integrations: [], syncDestinations: ['linear'] }
    apiFetch.mockResolvedValue({ ok: true, data: { synced: [{ externalId: 'L-1', url: 'u', provider: 'linear' }] } })
    await render(choice([FRONTEND], 'repo-front'))
    await act(async () => buttonByText('Sync to 1 destination')?.click())
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/integrations/sync/report-1', { method: 'POST' })
    expect(toast.info).not.toHaveBeenCalled()
  })
})

describe('ReportTriageBar feature-request confirmation', () => {
  /** The page's triage loop: updates merge into the report, the gate re-reads it. */
  function StatefulHarness({ initial }: { initial: ReportDetail }) {
    const [report, setReport] = useState(initial)
    const confirmed = useConfirmedDispatch({
      report,
      repoChoice: { repos: [FRONTEND], targetRepoId: FRONTEND.id, setTargetRepoId: () => {}, loading: false } as unknown as DispatchTargetRepo,
      busy: false,
      dispatch: () => {},
    })
    return createElement(ReportTriageBar, {
      report,
      onTriage: async (updates: Record<string, string>) => setReport((r) => ({ ...r, ...updates })),
      saving: false,
      savedAt: null,
      dispatchState: { status: 'idle' },
      onRequestDispatch: confirmed.request,
      dispatchBlock: confirmed.block,
      isDispatchBusy: false,
      repoChoice: { repos: [FRONTEND], targetRepoId: FRONTEND.id, setTargetRepoId: () => {}, loading: false } as unknown as DispatchTargetRepo,
    })
  }

  it('confirming the classifier category unblocks Dispatch fix without a reload', async () => {
    const feature = {
      ...REPORT,
      status: 'classified',
      category: 'visual',
      user_category: 'other',
      user_intent: 'Feature request',
      stage2_analysis: { category: 'visual' },
    } as unknown as ReportDetail
    await act(async () => root.render(createElement(StatefulHarness, { initial: feature })))
    expect(buttonByText('Dispatch fix')?.disabled).toBe(true)
    const confirm = buttonByText("It's a bug: confirm Visual")
    expect(confirm).toBeDefined()
    await act(async () => confirm!.click())
    expect(buttonByText('Dispatch fix')?.disabled).toBe(false)
    expect(buttonByText("It's a bug: confirm Visual")).toBeUndefined()
  })
})
