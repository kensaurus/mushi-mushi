/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/ReportTriageBar.test.tsx
 * PURPOSE: The "Repo" select beside Dispatch fix shows only for a project
 *          with more than one linked repo, starts on the primary, and the
 *          confirm names the repo the PR will open against.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchTargetRepo } from '../../lib/useDispatchTargetRepo'

type LinkedRepo = DispatchTargetRepo['repos'][number]
import type { ReportDetail } from './types'

vi.mock('../../lib/usePageData', () => ({ usePageData: () => ({ data: { integrations: [] } }) }))
vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/toast', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), push: vi.fn() }),
}))

import { ReportTriageBar } from './ReportTriageBar'

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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(repoChoice: DispatchTargetRepo, onDispatch = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      createElement(ReportTriageBar, {
        report: REPORT,
        onTriage: vi.fn(async () => {}),
        saving: false,
        savedAt: null,
        dispatchState: { status: 'idle' },
        onDispatch,
        isDispatchBusy: false,
        repoChoice,
      }),
    )
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
