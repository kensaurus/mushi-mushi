/**
 * FILE: fix-review-merge-gate.test.ts
 * PURPOSE: The agent PR review gate on the real fix routes (ADR 0030):
 *            POST /v1/admin/fixes/:id/merge refuses a "hold" (409
 *            REVIEW_HOLD) and never reaches GitHub; a hold stays a hold
 *            through a re-run and on newer commits; only a console session
 *            of a non-viewer with a reason can override (audited); an
 *            unreviewed, fix-first or stale-merge PR merges as before, and
 *            GitHub is asked to merge only the head commit the gate saw; a
 *            failed review read is a 503 unless the table does not exist yet;
 *            GET /v1/admin/fixes/:id/timeline carries the review (stale when
 *            the attempt's head moved);
 *            POST /v1/admin/fixes/:id/review re-queues without clearing the
 *            verdict, and refuses a running review, viewers and a burst.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000f-0000-4000-8000-0000000000aa'
const USER = '2000000f-0000-4000-8000-0000000000aa'
const FIX = '3000000f-0000-4000-8000-0000000000aa'

const mocks = vi.hoisted(() => ({
  merge: vi.fn(),
  finalize: vi.fn(),
  audit: vi.fn(),
  background: vi.fn(),
  rate: vi.fn(),
  head: { sha: 'sha1' as string | null },
  auth: { method: 'jwt' as string },
  role: { value: 'member' as string | null },
}))

let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', mocks.auth.method)
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next() }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: (...a: unknown[]) => mocks.audit(...a) }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  runInBackground: (...a: unknown[]) => mocks.background(...a),
  keepAlive: <T,>(p: T) => p,
}))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, claimTenantRateLimit: (...a: unknown[]) => mocks.rate(...a) }
})
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    installationIdForAttempt: async () => null,
    resolveProjectGithubToken: async () => 'gh-token',
    fetchPullRequest: async () => ({ number: 195, draft: false, state: 'open', merged: false, headSha: mocks.head.sha }),
  }
})
vi.mock('../../supabase/functions/_shared/fix-merge.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    mergeGithubPullRequest: (...a: unknown[]) => mocks.merge(...a),
    finalizeFixMerge: (...a: unknown[]) => mocks.finalize(...a),
  }
})
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    callerCanAccessProject: async () => ({ allowed: true, role: mocks.role.value }),
    callerProjectIds: async () => [P],
  }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerQueryFixesRepoRoutes } = await import('../../supabase/functions/api/routes/query-fixes-repo.ts')
  app = new Hono()
  registerQueryFixesRepoRoutes(app as never)
})

function attempt(over: Row = {}): Row {
  return {
    id: FIX,
    project_id: P,
    report_id: 'rep-1',
    agent: 'cursor_cloud',
    branch: 'bugfix/x',
    commit_sha: null,
    pr_url: 'https://github.com/acme/app/pull/195',
    pr_number: 195,
    merged_at: null,
    pr_state: 'open',
    repo_id: null,
    summary: 'fix lesson crash',
    status: 'completed',
    created_at: '2026-10-20T00:00:00Z',
    ...over,
  }
}

function review(over: Row = {}): Row {
  return {
    id: 'rev-1',
    fix_attempt_id: FIX,
    project_id: P,
    status: 'completed',
    verdict: 'hold',
    fixes_report: false,
    risk: 'high',
    findings: [{ severity: 'blocker', file: 'src/a.ts', line: 3, issue: 'Uses React private hooks.', suggested_fix: 'Use public API.' }],
    scope_creep: false,
    removes_behavior: [],
    needs_human_decision: null,
    summary: 'Relies on React internals that break on upgrade.',
    rules_applied: [],
    skip_reason: null,
    error: null,
    head_sha: 'sha1',
    diff_truncated: false,
    model: 'claude-opus-5-5',
    cost_usd: 0.21,
    comment_url: null,
    reviewed_at: '2026-10-21T08:00:00Z',
    completed_at: '2026-10-21T08:00:00Z',
    queued_at: '2026-10-21T07:55:00Z',
    started_at: '2026-10-21T07:56:00Z',
    attempts: 1,
    run_id: null,
    ...over,
  }
}

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const MERGE = `/v1/admin/fixes/${FIX}/merge`
const RERUN = `/v1/admin/fixes/${FIX}/review`

beforeEach(() => {
  mocks.merge.mockReset().mockResolvedValue({ merged: true, alreadyMerged: false, sha: 'mergesha' })
  mocks.finalize.mockReset().mockResolvedValue({ justMerged: true, reportStatus: 'fixed' })
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.background.mockReset()
  mocks.rate.mockReset().mockResolvedValue({ allowed: true })
  mocks.head.sha = 'sha1'
  mocks.auth.method = 'jwt'
  mocks.role.value = 'member'
})

describe('POST /v1/admin/fixes/:id/merge — the review gate', () => {
  it('refuses a hold, never calls GitHub, and does not quote the review in the message', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', MERGE, { mergeMethod: 'squash' })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(res.json.error.message).not.toContain('React internals')
    expect(res.json.error.message).not.toContain('override: true')
    expect(res.json.data.review.untrustedFields).toContain('summary')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('a console member overrides a hold with a reason: merged at the reviewed commit, audited', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', MERGE, { override: true, overrideReason: 'Checked by hand' })
    expect(res.status).toBe(200)
    expect(res.json.data.review).toEqual({ state: 'hold', label: 'Opus review: hold', overridden: true })
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'sha1' })
    const meta = mocks.audit.mock.calls.find((c) => c[3] === 'fix.merge')?.[6]
    expect(meta).toMatchObject({ review_state: 'hold', review_override: true, override_reason: 'Checked by hand', merged_head_sha: 'sha1' })
  })

  it('refuses an override without a reason, from an API key (CLI / MCP), or from a viewer', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const noReason = await call('POST', MERGE, { override: true })
    expect(noReason.status).toBe(400)
    expect(noReason.json.error.code).toBe('OVERRIDE_REASON_REQUIRED')

    mocks.auth.method = 'apiKey'
    const key = await call('POST', MERGE, { override: true, overrideReason: 'agent says fine' })
    expect(key.status).toBe(403)
    expect(key.json.error.code).toBe('OVERRIDE_NEEDS_CONSOLE')
    expect(key.json.error.message).toContain('console')

    mocks.auth.method = 'jwt'
    mocks.role.value = 'viewer'
    expect((await call('POST', MERGE, { override: true, overrideReason: 'x' })).status).toBe(403)

    mocks.role.value = 'member'
    expect((await call('POST', MERGE, { override: 'true', overrideReason: 'x' })).status).toBe(409)
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('a hold on an older commit keeps blocking until a review of the new head completes', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ head_sha: 'old' })] })
    mocks.head.sha = 'new'
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(409)
    expect(res.json.data.review.state).toBe('stale')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('a stale merge verdict does not count as reviewed: merged as "stale", at the head the gate saw', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'merge', head_sha: 'old' })] })
    mocks.head.sha = 'new'
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('stale')
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'new' })
  })

  it('a moved head between the check and the merge is a 409 HEAD_MOVED', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'merge' })] })
    mocks.merge.mockResolvedValue({ merged: false, alreadyMerged: false, headMoved: true, message: 'new commits' })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('HEAD_MOVED')
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('merges an unreviewed PR as before and says "Not reviewed"', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [] })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review).toEqual({ state: 'not_reviewed', label: 'Not reviewed', overridden: false })
  })

  it('merges a fix-first PR without an override, at the reviewed commit', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'fix_first' })] })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('fix_first')
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'sha1' })
  })

  it('fails closed when the review cannot be read', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()] }, { failRead: (t) => (t === 'fix_reviews' ? 'connection reset' : null) })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(503)
    expect(res.json.error.code).toBe('REVIEW_UNAVAILABLE')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('merges as "not reviewed" only when the table does not exist yet (before the migration)', async () => {
    db = makeFakeDb(
      { fix_attempts: [attempt()] },
      { failRead: (t) => (t === 'fix_reviews' ? { code: '42P01', message: 'relation "fix_reviews" does not exist' } : null) },
    )
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('not_reviewed')
  })
})

describe('GET /v1/admin/fixes/:id/timeline — carries the review', () => {
  it('returns the review next to the events', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
    const res = await call('GET', `/v1/admin/fixes/${FIX}/timeline`)
    expect(res.status).toBe(200)
    expect(res.json.data.review).toMatchObject({
      state: 'hold',
      label: 'Opus review: hold',
      fixesReport: false,
      findings: [{ severity: 'blocker', file: 'src/a.ts' }],
    })
  })

  it('marks a verdict about an older commit stale, from the attempt head the push webhook keeps', async () => {
    db = makeFakeDb({ fix_attempts: [attempt({ commit_sha: 'newer' })], fix_reviews: [review({ verdict: 'merge' })], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
    const res = await call('GET', `/v1/admin/fixes/${FIX}/timeline`)
    expect(res.json.data.review).toMatchObject({ state: 'stale', stale: true, verdict: 'merge' })
  })

  it('says "Not reviewed" for an attempt with no review', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
    const res = await call('GET', `/v1/admin/fixes/${FIX}/timeline`)
    expect(res.json.data.review).toMatchObject({ state: 'not_reviewed', label: 'Not reviewed' })
  })
})

describe('POST /v1/admin/fixes/:id/review — re-run', () => {
  it('re-queues the review but KEEPS the hold: a merge right after is still a 409', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', RERUN)
    expect(res.status).toBe(202)
    const row = db.tables.fix_reviews.find((r) => r.fix_attempt_id === FIX)!
    expect(row).toMatchObject({ status: 'queued', verdict: 'hold', head_sha: 'sha1', run_id: null, attempts: 0 })
    expect(res.json.data.review).toMatchObject({ state: 'hold', rerunning: true })
    expect(mocks.rate).toHaveBeenCalledWith(expect.anything(), `fix:${FIX}:pr_review_rerun`, 3, 3600)

    const merge = await call('POST', MERGE, {})
    expect(merge.status).toBe(409)
    expect(merge.json.error.code).toBe('REVIEW_HOLD')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('refuses a review that is already queued, or running and not stale', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ status: 'queued' })] })
    expect((await call('POST', RERUN)).status).toBe(409)
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ status: 'running', started_at: new Date().toISOString() })] })
    const running = await call('POST', RERUN)
    expect(running.status).toBe(409)
    expect(running.json.error.code).toBe('REVIEW_IN_PROGRESS')
    // A run that died long ago may be re-queued.
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ status: 'running', started_at: '2026-01-01T00:00:00Z' })] })
    expect((await call('POST', RERUN)).status).toBe(202)
  })

  it('refuses viewers and a burst of re-runs', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    mocks.role.value = 'viewer'
    expect((await call('POST', RERUN)).status).toBe(403)
    mocks.role.value = 'member'
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSec: 1200 })
    const limited = await call('POST', RERUN)
    expect(limited.status).toBe(429)
    expect(db.tables.fix_reviews[0]).toMatchObject({ status: 'completed' })
  })

  it('refuses a merged PR', async () => {
    db = makeFakeDb({ fix_attempts: [attempt({ pr_state: 'merged', merged_at: '2026-10-21T00:00:00Z' })], fix_reviews: [] })
    const res = await call('POST', RERUN)
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('PR_NOT_OPEN')
  })
})
