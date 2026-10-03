/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/useDispatchTargetRepo.test.tsx
 * PURPOSE: The repo choice for "Dispatch fix" starts on the primary repo, is
 *          sent only when a project has more than one linked repo, and
 *          reaches POST /v1/admin/fixes/dispatch as `targetRepoId`.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchTargetRepo } from './useDispatchTargetRepo'

type LinkedRepo = DispatchTargetRepo['repos'][number]

const pageData = vi.hoisted(() => ({ repos: [] as unknown, paths: [] as Array<string | null> }))
const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./usePageData', () => ({
  usePageData: (path: string | null) => {
    pageData.paths.push(path)
    return { data: path ? pageData.repos : null }
  },
}))
vi.mock('./supabase', () => ({ apiFetch: api.apiFetch, supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('./sseClient', () => ({ openSseStream: vi.fn(async () => {}) }))
vi.mock('./track', () => ({ trackSelf: vi.fn() }))

import { useDispatchTargetRepo } from './useDispatchTargetRepo'
import { useDispatchFix } from './dispatchFix'

const FRONTEND: LinkedRepo = { id: 'repo-front', repo_url: 'https://github.com/acme/solo-boss-cloud', default_branch: 'main', is_primary: true }
const BACKEND: LinkedRepo = { id: 'repo-back', repo_url: 'https://github.com/acme/solo-boss-cloud_backend', default_branch: 'develop', is_primary: false }

let container: HTMLDivElement
let root: Root
let latest: DispatchTargetRepo | null = null
let dispatchFn: ((o?: { targetRepoId?: string }) => Promise<void>) | null = null

function Harness({ projectId }: { projectId: string | null }) {
  latest = useDispatchTargetRepo(projectId)
  dispatchFn = useDispatchFix('report-1', 'project-1').dispatch
  return null
}

async function render(projectId: string | null = 'project-1'): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { projectId }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  pageData.paths = []
  api.apiFetch.mockReset()
  api.apiFetch.mockResolvedValue({ ok: true, data: { dispatchId: 'd-1', status: 'queued', createdAt: '' } })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  latest = null
})

describe('useDispatchTargetRepo', () => {
  it("starts on the primary repo and offers it for dispatch when there is a choice", async () => {
    pageData.repos = [FRONTEND, BACKEND]
    await render()
    expect(pageData.paths).toContain('/v1/admin/repo/repos?project_id=project-1')
    expect(latest?.targetRepoId).toBe('repo-front')
    expect(latest?.dispatchTargetRepoId).toBe('repo-front')
    expect(latest?.target).toEqual(FRONTEND)

    await act(async () => latest?.setTargetRepoId('repo-back'))
    expect(latest?.dispatchTargetRepoId).toBe('repo-back')
    expect(latest?.target).toEqual(BACKEND)
  })

  it('sends nothing for a single-repo project', async () => {
    pageData.repos = [FRONTEND]
    await render()
    expect(latest?.dispatchTargetRepoId).toBeUndefined()
  })

  it('sends nothing for "Project default" when no repo is primary', async () => {
    pageData.repos = [{ ...FRONTEND, is_primary: false }, BACKEND]
    await render()
    expect(latest?.targetRepoId).toBe('')
    expect(latest?.dispatchTargetRepoId).toBeUndefined()
  })

  it('does not fetch without a project', async () => {
    await render(null)
    expect(pageData.paths.every((p) => p === null)).toBe(true)
    expect(latest?.repos).toEqual([])
  })
})

describe('useDispatchFix payload', () => {
  function dispatchBody(): Record<string, unknown> {
    const call = api.apiFetch.mock.calls.find(([path]) => path === '/v1/admin/fixes/dispatch')
    return JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}'))
  }

  it('carries targetRepoId when a repo was chosen', async () => {
    await render()
    await act(async () => dispatchFn?.({ targetRepoId: 'repo-back' }))
    expect(dispatchBody()).toEqual({ reportId: 'report-1', projectId: 'project-1', targetRepoId: 'repo-back' })
  })

  it('omits targetRepoId otherwise', async () => {
    await render()
    await act(async () => dispatchFn?.())
    expect(dispatchBody()).toEqual({ reportId: 'report-1', projectId: 'project-1' })
  })
})
