/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/recipe/useRecipeChange.test.tsx
 * PURPOSE: Preview → confirm → follow for a recipe change:
 *   (a) confirm resends exactly the previewed edits (with their base SHAs)
 *       as dryRun:false, wait:false under the preview's idempotency key, and
 *       follows the job on the SSE stream to the PR;
 *   (b) a stream that closes before the end falls back to polling the job;
 *   (c) a 409 ALREADY_RUNNING follows the running job instead of failing;
 *   (d) a preview answered after reset() is dropped.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SseClientOptions } from '../../lib/sseClient'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } })) } },
}))
vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/env', () => ({ RESOLVED_API_URL: 'https://api.test' }))
const sse = vi.hoisted(() => ({ openSseStream: vi.fn() }))
vi.mock('../../lib/sseClient', () => sse)

import { useRecipeChange } from './useRecipeChange'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const P = '1000000a-0000-4000-8000-000000000000'
const JOB = '5000000a-0000-4000-8000-000000000000'
const EDITS = [{ path: 'mushi.recipe.json', content: '{}\n', baseSha: 'sha-1' }]
const DRY = { ok: true, data: { dryRun: true, ok: true, reason: null, files: [{ path: 'mushi.recipe.json', diff: '@@\n-a\n+b', additions: 1, deletions: 1 }], denied: [] } }

let hook: ReturnType<typeof useRecipeChange> | null = null
function Probe() {
  hook = useRecipeChange(P, 'gates', { pollMs: 5 })
  return createElement('span', { 'data-phase': hook.state.phase })
}

async function flush(n = 8) {
  for (let i = 0; i < n; i += 1) await Promise.resolve()
}

function status(payload: Record<string, unknown>) {
  return { event: 'status', data: JSON.stringify({ prUrl: null, prNumber: null, branch: null, startedAt: null, finishedAt: null, error: null, ...payload }) }
}

describe('useRecipeChange', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetchMutate.mockReset()
    sse.openSseStream.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(Probe)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    hook = null
  })

  it('confirms exactly what was previewed, once, and follows the stream to the draft PR', async () => {
    api.apiFetchMutate.mockResolvedValueOnce(DRY).mockResolvedValueOnce({ ok: true, data: { jobId: JOB, projectId: P, status: 'queued', prUrl: null, error: null } })
    sse.openSseStream.mockImplementation(async (o: SseClientOptions) => {
      o.onEvent(status({ status: 'queued' }))
      o.onEvent(status({ status: 'running' }))
      o.onEvent(status({ status: 'pr_opened', prUrl: 'https://github.com/k/glot/pull/9', prNumber: 9, branch: 'mushi/recipe-gates-x' }))
      o.onEvent({ event: 'done', data: '{"done":true}' })
      o.onClose?.('end')
    })

    await act(async () => { await hook!.preview(EDITS) })
    expect(hook!.state.phase).toBe('previewed')
    const [path, dry] = api.apiFetchMutate.mock.calls[0]
    expect(path).toBe(`/v1/admin/projects/${P}/recipe/changes`)
    expect(JSON.parse(dry.body)).toEqual({ element: 'gates', edits: EDITS, dryRun: true })

    await act(async () => { await hook!.confirm(); await flush() })
    const real = api.apiFetchMutate.mock.calls[1][1]
    expect(JSON.parse(real.body)).toEqual({ element: 'gates', edits: EDITS, dryRun: false, wait: false })
    expect(real.idempotencyKey).toBeTruthy()
    expect(real.idempotencyKey).not.toBe(dry.idempotencyKey)
    expect(sse.openSseStream.mock.calls[0][0]).toMatchObject({ url: `https://api.test/v1/admin/projects/${P}/recipe/changes/${JOB}/stream`, bearer: 'jwt' })
    expect(hook!.state).toMatchObject({ phase: 'done', job: { jobId: JOB, status: 'pr_opened', prUrl: 'https://github.com/k/glot/pull/9', prNumber: 9 } })
    expect(api.apiFetch).not.toHaveBeenCalled()

    // A second confirm with nothing previewed does nothing.
    await act(async () => { await hook!.confirm() })
    expect(api.apiFetchMutate).toHaveBeenCalledTimes(2)
  })

  it('falls back to polling the job when the stream closes early', async () => {
    api.apiFetchMutate.mockResolvedValueOnce(DRY).mockResolvedValueOnce({ ok: true, data: { jobId: JOB, projectId: P, status: 'queued', prUrl: null, error: null } })
    sse.openSseStream.mockImplementation(async (o: SseClientOptions) => {
      o.onEvent(status({ status: 'running' }))
      o.onClose?.('error', new Error('SSE HTTP 502'))
    })
    const row = (s: string, extra: Record<string, unknown> = {}) => ({ ok: true, data: { id: JOB, element: 'gates', status: s, pr_url: null, pr_number: null, branch: null, error: null, batch_id: null, created_at: '', started_at: null, finished_at: null, ...extra } })
    api.apiFetch.mockResolvedValueOnce(row('running')).mockResolvedValueOnce(row('rejected', { error: 'Nothing would change.' }))

    await act(async () => { await hook!.preview(EDITS) })
    await act(async () => { await hook!.confirm(); await flush() })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); await flush() })
    expect(api.apiFetch).toHaveBeenCalledWith(`/v1/admin/projects/${P}/recipe/changes/${JOB}`, { cache: 'no-store' })
    expect(hook!.state).toMatchObject({ phase: 'done', job: { status: 'rejected', error: 'Nothing would change.' } })
  })

  it('follows the running job when the server says one is already running', async () => {
    const OTHER = '5000000b-0000-4000-8000-000000000000'
    api.apiFetchMutate.mockResolvedValueOnce(DRY).mockResolvedValueOnce({ ok: false, error: { code: 'ALREADY_RUNNING', message: 'busy' }, data: { jobId: OTHER } })
    sse.openSseStream.mockImplementation(async (o: SseClientOptions) => {
      o.onEvent(status({ status: 'failed', error: 'boom' }))
      o.onClose?.('end')
    })
    await act(async () => { await hook!.preview(EDITS) })
    await act(async () => { await hook!.confirm(); await flush() })
    expect(sse.openSseStream.mock.calls[0][0].url).toContain(`/recipe/changes/${OTHER}/stream`)
    expect(hook!.state).toMatchObject({ phase: 'done', note: expect.stringMatching(/already running/), job: { jobId: OTHER, status: 'failed' } })
  })

  it('drops a preview that answers after reset, and reports a repo with nothing writable', async () => {
    let answer: (v: unknown) => void = () => {}
    api.apiFetchMutate.mockReturnValueOnce(new Promise((r) => { answer = r }))
    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = hook!.preview(EDITS) })
    act(() => hook!.reset())
    await act(async () => { answer(DRY); await pending })
    expect(hook!.state.phase).toBe('idle')

    api.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { dryRun: true, ok: false, reason: 'This repo has no valid mushi.recipe.json', files: [], denied: [] } })
    await act(async () => { await hook!.preview(EDITS) })
    expect(hook!.state).toMatchObject({ phase: 'error', error: 'This repo has no valid mushi.recipe.json' })
  })
})
