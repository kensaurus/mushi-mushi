/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/useDeviancePoll.test.tsx
 * PURPOSE: POST /design/deviance/run answers 202 with a running scan. The
 *          page must keep polling GET /design/deviance while `running` is set,
 *          report the finished run only once it is no longer running, and
 *          give up (saying so) after repeated poll failures.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignDevianceResponse, DevianceRun } from '../../lib/recipeTypes'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { DEVIANCE_POLL_MS, describeDevianceSettle, useDeviancePoll, type DevianceSettle } from './useDeviancePoll'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function run(overrides: Partial<DevianceRun>): DevianceRun {
  return {
    runId: 'run-1',
    status: 'running',
    score: null,
    scannedFiles: 0,
    scannedLines: 0,
    matchedFiles: 0,
    truncated: false,
    commitSha: null,
    startedAt: '2026-10-02T00:00:00Z',
    completedAt: null,
    breakdown: [],
    counts: {},
    storedFindings: 0,
    error: null,
    ...overrides,
  }
}

function deviance(running: DevianceRun | null, latest: DevianceRun | null) {
  const data: DesignDevianceResponse = { projectId: 'p1', latest, running, trend: [], findings: [], rules: [] }
  return { ok: true, data }
}

let hook: ReturnType<typeof useDeviancePoll> | null = null
function Probe({ onSettled }: { onSettled: (o: DevianceSettle) => void }) {
  hook = useDeviancePoll({ projectId: 'p1', onSettled })
  return createElement('span', { 'data-running': hook.running ? hook.running.runId : '' })
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('useDeviancePoll', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    api.apiFetch.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    hook = null
  })

  async function mount(onSettled: (o: DevianceSettle) => void) {
    await act(async () => {
      root.render(createElement(Probe, { onSettled }))
      await flush()
    })
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
      await flush()
    })
  }

  it('polls while the scan runs, then reports the finished run', async () => {
    const finished = run({ status: 'pass', score: 18, completedAt: '2026-10-02T00:01:00Z' })
    api.apiFetch
      .mockResolvedValueOnce(deviance(null, null)) // mount check: nothing running
      .mockResolvedValueOnce(deviance(run({}), null)) // poll 1: still running
      .mockResolvedValueOnce(deviance(null, finished)) // poll 2: done
    const onSettled = vi.fn()
    await mount(onSettled)

    act(() => hook?.follow(run({})))
    expect(container.querySelector('span')?.dataset.running).toBe('run-1')

    await advance(DEVIANCE_POLL_MS)
    expect(onSettled).not.toHaveBeenCalled()
    expect(container.querySelector('span')?.dataset.running).toBe('run-1')

    await advance(DEVIANCE_POLL_MS)
    expect(onSettled).toHaveBeenCalledWith({ kind: 'finished', run: finished })
    expect(container.querySelector('span')?.dataset.running).toBe('')
    expect(api.apiFetch).toHaveBeenCalledTimes(3)
    expect(api.apiFetch.mock.calls[1]?.[0]).toBe('/v1/admin/projects/p1/design/deviance?limit=1')

    // No more polling once settled.
    await advance(DEVIANCE_POLL_MS * 3)
    expect(api.apiFetch).toHaveBeenCalledTimes(3)
  })

  it('picks up a scan that was already running when the page opened', async () => {
    api.apiFetch.mockResolvedValueOnce(deviance(run({ runId: 'run-9' }), null))
    await mount(vi.fn())
    expect(container.querySelector('span')?.dataset.running).toBe('run-9')
  })

  it('gives up after three failed polls instead of spinning forever', async () => {
    api.apiFetch
      .mockResolvedValueOnce(deviance(null, null))
      .mockResolvedValue({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Request failed' } })
    const onSettled = vi.fn()
    await mount(onSettled)
    act(() => hook?.follow(run({})))

    await advance(DEVIANCE_POLL_MS * 3)
    expect(onSettled).toHaveBeenCalledWith({ kind: 'gave_up', reason: 'Request failed' })
    expect(container.querySelector('span')?.dataset.running).toBe('')
  })

  it('ignores a run that is not running', async () => {
    api.apiFetch.mockResolvedValueOnce(deviance(null, null))
    await mount(vi.fn())
    act(() => hook?.follow(run({ status: 'pass', score: 3 })))
    expect(container.querySelector('span')?.dataset.running).toBe('')
  })
})

describe('describeDevianceSettle', () => {
  it('reports a stale scan the server marked as error as a failure', () => {
    const out = describeDevianceSettle({
      kind: 'finished',
      run: run({ status: 'error', error: 'The scan did not finish within 15 minutes.' }),
    })
    expect(out).toEqual({ tone: 'danger', text: 'The scan did not finish within 15 minutes.' })
  })

  it('never calls a null score 0', () => {
    expect(describeDevianceSettle({ kind: 'finished', run: run({ status: 'warn', score: null }) }).text).toBe(
      'Scan finished — not scored.',
    )
  })

  it('says it stopped checking rather than claiming the scan finished', () => {
    const out = describeDevianceSettle({ kind: 'gave_up', reason: 'Request failed' })
    expect(out.tone).toBe('warn')
    expect(out.text).toContain('may still finish')
  })
})
