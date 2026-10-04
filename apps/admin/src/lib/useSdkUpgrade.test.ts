import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetch: vi.fn(), supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('./sseClient', () => ({ openSseStream: vi.fn() }))

import { coerceApiResult } from './apiEnvelope'
import { alreadyInProgressJobId } from './useSdkUpgrade'

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
