/**
 * FILE: fix-review-merge-gate.test.ts
 * PURPOSE: The agent PR review gate on the real routes (ADR 0030):
 *            POST /v1/admin/fixes/:id/merge refuses a "hold" (409
 *            REVIEW_HOLD) and never reaches GitHub, merges it with
 *            override: true (audited), and merges an unreviewed or
 *            "fix first" PR as before, saying which;
 *            GET /v1/admin/fixes/:id/timeline carries the review;
 *            POST /v1/admin/fixes/:id/review re-queues it and clears the
 *            old verdict.
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
    c.set('authMethod', 'jwt')
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
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, installationIdForAttempt: async () => null, resolveProjectGithubToken: async () => 'gh-token' }
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
    callerCanAccessProject: async () => ({ allowed: true }),
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
    head_sha: 'abc1234',
    diff_truncated: false,
    model: 'claude-opus-5-5',
    cost_usd: 0.21,
    comment_url: null,
    completed_at: '2026-10-21T08:00:00Z',
    queued_at: '2026-10-21T07:55:00Z',
    attempts: 1,
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

beforeEach(() => {
  mocks.merge.mockReset().mockResolvedValue({ merged: true, alreadyMerged: false, sha: 'mergesha' })
  mocks.finalize.mockReset().mockResolvedValue({ justMerged: true, reportStatus: 'fixed' })
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.background.mockReset()
})

describe('POST /v1/admin/fixes/:id/merge — the review gate', () => {
  it('refuses a hold verdict and never calls GitHub', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/merge`, { mergeMethod: 'squash' })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(res.json.error.message).toContain('Relies on React internals')
    expect(mocks.merge).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('merges a hold with override: true and records the override', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/merge`, { override: true, overrideReason: 'Checked by hand' })
    expect(res.status).toBe(200)
    expect(res.json.data.review).toEqual({ state: 'hold', label: 'Opus review: hold', overridden: true })
    expect(mocks.merge).toHaveBeenCalledTimes(1)
    const meta = mocks.audit.mock.calls.find((c) => c[3] === 'fix.merge')?.[6]
    expect(meta).toMatchObject({ review_state: 'hold', review_override: true, override_reason: 'Checked by hand' })
  })

  it('only a literal true overrides', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/merge`, { override: 'true' })
    expect(res.status).toBe(409)
  })

  it('merges an unreviewed PR as before and says "Not reviewed"', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/merge`, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review).toEqual({ state: 'not_reviewed', label: 'Not reviewed', overridden: false })
  })

  it('merges a fix-first PR without an override', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'fix_first' })] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/merge`, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('fix_first')
  })

  it('merges when the review cannot be read (table missing before the migration)', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()] }, { failRead: (t) => (t === 'fix_reviews' ? 'relation does not exist' : null) })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/merge`, {})
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

  it('says "Not reviewed" for an attempt with no review', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
    const res = await call('GET', `/v1/admin/fixes/${FIX}/timeline`)
    expect(res.json.data.review).toMatchObject({ state: 'not_reviewed', label: 'Not reviewed' })
  })
})

describe('POST /v1/admin/fixes/:id/review — re-run', () => {
  it('re-queues the review and clears the old verdict, so a stale hold stops gating', async () => {
    db = makeFakeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/review`)
    expect(res.status).toBe(202)
    const row = db.tables.fix_reviews.find((r) => r.fix_attempt_id === FIX)!
    expect(row).toMatchObject({ status: 'queued', verdict: null, attempts: 0 })
    expect(res.json.data.review.state).toBe('queued')

    const merge = await call('POST', `/v1/admin/fixes/${FIX}/merge`, {})
    expect(merge.status).toBe(200)
  })

  it('refuses a merged PR', async () => {
    db = makeFakeDb({ fix_attempts: [attempt({ pr_state: 'merged', merged_at: '2026-10-21T00:00:00Z' })], fix_reviews: [] })
    const res = await call('POST', `/v1/admin/fixes/${FIX}/review`)
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('PR_NOT_OPEN')
  })
})
