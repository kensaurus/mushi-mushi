/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetch: vi.fn(), supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('./sseClient', () => ({ openSseStream: vi.fn() }))

import { coerceApiResult } from './apiEnvelope'
import { apiFetch } from './supabase'
import {
  alreadyInProgressJobId,
  isOpenUpgradePr,
  UPGRADE_CI_REFRESH_MS,
  upgradeCiRefreshDue,
  useSdkUpgrade,
} from './useSdkUpgrade'

// QA bug 124: a second "Create Upgrade PR" click got a 409 ALREADY_IN_PROGRESS
// whose jobId the envelope dropped, so the CTA turned into a raw failure pill
// instead of following the job that was already running.
describe('alreadyInProgressJobId', () => {
  it('reads the running job from data.jobId after the envelope is applied', () => {
    const res = coerceApiResult({
      ok: false,
      error: { code: 'ALREADY_IN_PROGRESS', message: 'An SDK upgrade is already in progress for this project.', jobId: 'job-9' },
      data: { jobId: 'job-9' },
    })
    expect(alreadyInProgressJobId(res)).toBe('job-9')
  })

  it('is null for any other failure, and for success', () => {
    expect(alreadyInProgressJobId({ ok: false, error: { code: 'NO_REPO' }, data: { jobId: 'x' } })).toBeNull()
    expect(alreadyInProgressJobId({ ok: true, data: { jobId: 'x' } })).toBeNull()
    expect(alreadyInProgressJobId({ ok: false, error: { code: 'ALREADY_IN_PROGRESS' } })).toBeNull()
  })
})

describe('upgrade CI refresh timing', () => {
  it('is due until a minute has passed', () => {
    expect(upgradeCiRefreshDue(null, 1_000)).toBe(true)
    expect(upgradeCiRefreshDue(Number.NaN, 1_000)).toBe(true)
    const at = 10_000
    expect(upgradeCiRefreshDue(at, at + UPGRADE_CI_REFRESH_MS - 1)).toBe(false)
    expect(upgradeCiRefreshDue(at, at + UPGRADE_CI_REFRESH_MS)).toBe(true)
  })

  it('treats a merged or closed upgrade PR as finished', () => {
    expect(isOpenUpgradePr({ status: 'completed', prUrl: 'https://github.com/a/b/pull/1', prState: 'open' })).toBe(true)
    expect(isOpenUpgradePr({ status: 'completed', prUrl: 'https://github.com/a/b/pull/1' })).toBe(true)
    expect(isOpenUpgradePr({ status: 'completed', prUrl: 'https://github.com/a/b/pull/1', prState: 'merged' })).toBe(false)
    expect(isOpenUpgradePr({ status: 'completed', prUrl: 'https://github.com/a/b/pull/1', prState: 'closed' })).toBe(false)
    expect(isOpenUpgradePr({ status: 'completed', prUrl: 'https://github.com/a/b/pull/1', mergedAt: '2026-10-23' })).toBe(false)
    expect(isOpenUpgradePr({ status: 'completed' })).toBe(false)
  })
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>
const PROJECT = '3000000f-0000-4000-8000-000000000137'
const OPEN_JOB = {
  id: 'job-137',
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/help-her-take-photo/pull/137',
  pr_state: 'open',
  check_run_status: 'completed',
  check_run_conclusion: 'failure',
  plan: [{ package: '@mushi-mushi/react-native', from: '0.24.0', to: '0.24.3' }],
}

function syncPayload(conclusion: 'success' | 'failure') {
  return {
    ok: true,
    data: {
      releaseStatus: conclusion === 'success' ? 'ready_to_merge' : 'blocked',
      prState: 'open',
      checkRunStatus: 'completed',
      checkRunConclusion: conclusion,
      workflowStatus: null,
      workflowConclusion: null,
      workflowUrl: null,
      deployStatus: null,
      deployUrl: null,
      deployEnvironment: null,
    },
  }
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

describe('useSdkUpgrade open PR', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/sync')) return syncPayload('success')
      if (String(path).endsWith('/merge')) return { ok: true, data: { alreadyMerged: false, sha: 'abc' } }
      if (String(path).includes('/in-flight')) return { ok: true, data: OPEN_JOB }
      return { ok: false, error: { code: 'NO', message: 'unexpected' } }
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function Probe() {
    const { state, mergePr } = useSdkUpgrade(PROJECT)
    return createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'ci' }, state.checkRunConclusion ?? 'none'),
      createElement('span', { 'data-testid': 'pr' }, state.prState ?? 'none'),
      createElement('button', { onClick: () => void mergePr('job-137') }, 'do-merge'),
    )
  }

  async function renderProbe() {
    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()
  }

  it('re-reads GitHub when the open PR is shown, replacing a stale failure', async () => {
    await renderProbe()
    expect(host.querySelector('[data-testid="ci"]')?.textContent).toBe('success')
    const syncs = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/sync'))
    expect(syncs).toHaveLength(1)
    expect(syncs[0][1]).toMatchObject({ method: 'POST' })

    act(() => root.unmount())
    root = createRoot(host)
    await renderProbe()
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/sync'))).toHaveLength(1)
    expect(host.querySelector('[data-testid="ci"]')?.textContent).toBe('success')
  })

  it('marks the job merged after the gated merge succeeds', async () => {
    await renderProbe()
    const button = host.querySelector('button') as HTMLButtonElement
    await act(async () => {
      button.click()
    })
    await flush()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/merge'))).toBe(true)
    expect(host.querySelector('[data-testid="pr"]')?.textContent).toBe('merged')
  })
})
