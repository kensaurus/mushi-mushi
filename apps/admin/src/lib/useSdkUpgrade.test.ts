import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetch: vi.fn(), supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('./sseClient', () => ({ openSseStream: vi.fn() }))

import { coerceApiResult } from './apiEnvelope'
import { apiFetch } from './supabase'
import {
  alreadyInProgressJobId,
  applyUpgradeCi,
  describeSyncFailure,
  markUpgradeCiRefresh,
  mergeLoadedUpgradeJob,
  readUpgradeCiRefreshAt,
  upgradeCiRefreshDecision,
  useSdkUpgrade,
  type SdkUpgradeState,
  type UpgradeCiPayload,
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

const OPEN_PR = {
  status: 'completed',
  jobId: 'job-1',
  prUrl: 'https://github.com/acme/app/pull/7',
  prState: 'open' as string | null,
  mergedAt: null as string | null,
}

const GREEN: UpgradeCiPayload = {
  releaseStatus: 'ready_to_merge',
  prState: 'open',
  checkRunStatus: 'completed',
  checkRunConclusion: 'success',
  deployStatus: null,
  deployUrl: null,
  workflowUrl: null,
}

describe('upgradeCiRefreshDecision', () => {
  const now = 1_700_000_000_000

  it('re-reads an open PR on the first look, whatever conclusion was saved', () => {
    expect(upgradeCiRefreshDecision(OPEN_PR, null, now)).toBe('refresh')
  })

  it('re-reads an open PR that has not been synced yet', () => {
    expect(upgradeCiRefreshDecision({ ...OPEN_PR, prState: null }, null, now)).toBe('refresh')
  })

  it('skips a refresh that already ran within the minute', () => {
    expect(upgradeCiRefreshDecision(OPEN_PR, now - 30_000, now)).toBe('skip')
    expect(upgradeCiRefreshDecision(OPEN_PR, now - 60_000, now)).toBe('refresh')
  })

  it('does not refresh a merged, closed, or still-running job', () => {
    expect(upgradeCiRefreshDecision({ ...OPEN_PR, prState: 'merged' }, null, now)).toBe('skip')
    expect(upgradeCiRefreshDecision({ ...OPEN_PR, mergedAt: '2026-10-26T00:00:00Z' }, null, now)).toBe('skip')
    expect(upgradeCiRefreshDecision({ ...OPEN_PR, prState: 'closed' }, null, now)).toBe('skip')
    expect(upgradeCiRefreshDecision({ ...OPEN_PR, status: 'running' }, null, now)).toBe('skip')
    expect(upgradeCiRefreshDecision({ ...OPEN_PR, prUrl: null }, null, now)).toBe('skip')
  })
})

describe('upgrade CI refresh storage', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('round-trips the last refresh time per job', () => {
    expect(readUpgradeCiRefreshAt(window.sessionStorage, 'proj', 'job-1')).toBeNull()
    markUpgradeCiRefresh(window.sessionStorage, 'proj', 'job-1', 42)
    expect(readUpgradeCiRefreshAt(window.sessionStorage, 'proj', 'job-1')).toBe(42)
    expect(readUpgradeCiRefreshAt(window.sessionStorage, 'proj', 'job-2')).toBeNull()
  })
})

describe('mergeLoadedUpgradeJob', () => {
  const stale = {
    status: 'completed' as const,
    jobId: 'job-1',
    prUrl: OPEN_PR.prUrl,
    checkRunConclusion: 'failure',
    releaseStatus: 'blocked',
  }

  it('keeps a green sync that landed before the saved snapshot is committed', () => {
    const merged = mergeLoadedUpgradeJob({ status: 'idle' }, stale, null, { jobId: 'job-1', data: GREEN })
    expect(merged.checkRunConclusion).toBe('success')
    expect(merged.releaseStatus).toBe('ready_to_merge')
  })

  it('does not let the saved failure overwrite a sync already applied to this job', () => {
    const current = applyUpgradeCi(stale, GREEN)
    const merged = mergeLoadedUpgradeJob(current, stale, 'job-1', null)
    expect(merged.checkRunConclusion).toBe('success')
  })

  it('keeps the saved snapshot when no sync has landed', () => {
    expect(mergeLoadedUpgradeJob({ status: 'idle' }, stale, null, null).checkRunConclusion).toBe('failure')
  })
})

// Mushi report 6449a621: a GitHub 403 on "Check CI status" used to wipe the
// CI chips to "not checked yet". The server now answers 502 and stores
// nothing; the console says so and keeps the last known state.
describe('describeSyncFailure', () => {
  it('names the GitHub failure and says the last known state is shown', () => {
    expect(describeSyncFailure({
      code: 'GITHUB_UNAVAILABLE',
      message: "GitHub did not answer (HTTP 403, likely GitHub's rate limit)",
    })).toBe("Couldn't check: GitHub did not answer (HTTP 403, likely GitHub's rate limit); showing the last known state.")
  })

  it('falls back to a plain reason for a bare code', () => {
    expect(describeSyncFailure({ code: 'SYNC_PERSIST_FAILED', message: 'SYNC_PERSIST_FAILED' }))
      .toBe("Couldn't check: the CI status could not be read; showing the last known state.")
  })
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fetchMock = vi.mocked(apiFetch)
const probe: { current: { state: SdkUpgradeState; syncStatus: (jobId: string) => Promise<void> } | null } = {
  current: null,
}

function SyncProbe({ projectId }: { projectId: string }) {
  const { state, syncStatus } = useSdkUpgrade(projectId)
  probe.current = { state, syncStatus }
  return createElement('span', { 'data-syncing': state.syncing ? '1' : '0' })
}

function rememberOpenPr(projectId: string) {
  window.sessionStorage.setItem(
    `mushi_sdk_upgrade_terminal:${projectId}`,
    JSON.stringify({
      status: 'completed',
      jobId: 'job-1',
      prUrl: 'https://github.com/acme/app/pull/7',
      prState: 'open',
      checkRunConclusion: 'failure',
      savedAt: Date.now(),
    }),
  )
}

describe('syncStatus page-open refresh', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.sessionStorage.clear()
    fetchMock.mockReset()
    probe.current = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('a failed refresh does not count toward the once-a-minute limit', async () => {
    const projectId = 'proj-fail'
    rememberOpenPr(projectId)
    let resolveSync: (value: unknown) => void = () => {}
    const syncPromise = new Promise((resolve) => { resolveSync = resolve })
    fetchMock.mockImplementation((path: string) => {
      if (String(path).includes('/sync')) return syncPromise as ReturnType<typeof apiFetch>
      return Promise.resolve({ ok: true, data: null }) as ReturnType<typeof apiFetch>
    })

    await act(async () => {
      root.render(createElement(SyncProbe, { projectId }))
    })
    expect(readUpgradeCiRefreshAt(window.sessionStorage, projectId, 'job-1')).toBeNull()

    await act(async () => {
      resolveSync({ ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'GitHub did not answer (HTTP 403)' } })
      await syncPromise
    })
    expect(readUpgradeCiRefreshAt(window.sessionStorage, projectId, 'job-1')).toBeNull()
    expect(probe.current?.state.syncError).toContain('HTTP 403')
  })

  it('a successful refresh records the time and the green conclusion', async () => {
    const projectId = 'proj-ok'
    rememberOpenPr(projectId)
    fetchMock.mockImplementation((path: string) => {
      if (String(path).includes('/sync')) return Promise.resolve({ ok: true, data: GREEN }) as ReturnType<typeof apiFetch>
      return Promise.resolve({ ok: true, data: null }) as ReturnType<typeof apiFetch>
    })

    await act(async () => {
      root.render(createElement(SyncProbe, { projectId }))
      await Promise.resolve()
    })
    expect(readUpgradeCiRefreshAt(window.sessionStorage, projectId, 'job-1')).toEqual(expect.any(Number))
    expect(probe.current?.state.checkRunConclusion).toBe('success')
    expect(probe.current?.state.syncing).toBe(false)
  })

  it('a sync that finishes before a job is loaded does not leave syncing on', async () => {
    const projectId = 'proj-empty'
    let resolveInflight: (value: unknown) => void = () => {}
    const inflight = new Promise((resolve) => { resolveInflight = resolve })
    fetchMock.mockImplementation((path: string) => {
      if (String(path).includes('/sync')) return Promise.resolve({ ok: true, data: GREEN }) as ReturnType<typeof apiFetch>
      return inflight as ReturnType<typeof apiFetch>
    })

    await act(async () => {
      root.render(createElement(SyncProbe, { projectId }))
    })
    await act(async () => {
      resolveInflight({ ok: true, data: null })
      await inflight
    })
    await act(async () => {
      await probe.current?.syncStatus('job-9')
    })
    expect(container.querySelector('[data-syncing]')?.getAttribute('data-syncing')).toBe('0')
  })
})
