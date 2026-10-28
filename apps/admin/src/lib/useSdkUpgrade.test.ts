import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetch: vi.fn(), supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('./sseClient', () => ({ openSseStream: vi.fn() }))

import { coerceApiResult } from './apiEnvelope'
import { alreadyInProgressJobId, describeSyncFailure } from './useSdkUpgrade'

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
