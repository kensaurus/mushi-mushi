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
 *            verdict, and refuses a running review, viewers and a burst;
 *          and the ways around a hold the second review found: a rewritten
 *          fix_attempts.pr_url (PATCH is locked, and the gate also matches
 *          fix_reviews.pr_url), an API key re-running a hold until it flips,
 *          an API key merging while the first review runs, and a merge path
 *          that calls GitHub without the gate.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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
  /** `base.repo` of the PR as GitHub answers it (null: GitHub left it out). */
  base: { id: null as number | null, fullName: null as string | null },
  auth: { method: 'jwt' as string },
  role: { value: 'member' as string | null },
}))

let db: FakeDb

/** The project's connected repo, which every gated merge now requires. */
const REPOS = [{ project_id: '1000000f-0000-4000-8000-0000000000aa', repo_url: 'https://github.com/acme/app', is_primary: true }]
function makeDb(tables: Record<string, Row[]>, opts?: Parameters<typeof makeFakeDb>[1]): FakeDb {
  return makeFakeDb({ project_repos: REPOS, ...tables }, opts)
}

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
    fetchPullRequest: async () => ({
      number: 195,
      draft: false,
      state: 'open',
      merged: false,
      headSha: mocks.head.sha,
      baseRepoId: mocks.base.id,
      baseRepoFullName: mocks.base.fullName,
    }),
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
    pr_url: 'https://github.com/acme/app/pull/195',
    repo: 'acme/app',
    pr_number: 195,
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
  mocks.base.id = null
  mocks.base.fullName = null
  mocks.auth.method = 'jwt'
  mocks.role.value = 'member'
})

describe('POST /v1/admin/fixes/:id/merge — the review gate', () => {
  it('refuses a hold, never calls GitHub, and does not quote the review in the message', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', MERGE, { mergeMethod: 'squash' })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(res.json.error.message).not.toContain('React internals')
    expect(res.json.error.message).not.toContain('override: true')
    expect(res.json.data.review.untrustedFields).toContain('summary')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('a console member overrides a hold with a reason: merged at the reviewed commit, audited', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    const res = await call('POST', MERGE, { override: true, overrideReason: 'Checked by hand' })
    expect(res.status).toBe(200)
    expect(res.json.data.review).toEqual({ state: 'hold', label: 'Opus review: hold', overridden: true })
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'sha1' })
    const meta = mocks.audit.mock.calls.find((c) => c[3] === 'fix.merge')?.[6]
    expect(meta).toMatchObject({ review_state: 'hold', review_override: true, override_reason: 'Checked by hand', merged_head_sha: 'sha1' })
  })

  it('refuses an override without a reason, from an API key (CLI / MCP), or from a viewer', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
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
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ head_sha: 'old' })] })
    mocks.head.sha = 'new'
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(409)
    expect(res.json.data.review.state).toBe('stale')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('a stale merge verdict does not count as reviewed: merged as "stale", at the head the gate saw', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'merge', head_sha: 'old' })] })
    mocks.head.sha = 'new'
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('stale')
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'new' })
  })

  it('a moved head between the check and the merge is a 409 HEAD_MOVED', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'merge' })] })
    mocks.merge.mockResolvedValue({ merged: false, alreadyMerged: false, headMoved: true, message: 'new commits' })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('HEAD_MOVED')
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('merges an unreviewed PR as before and says "Not reviewed"', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [] })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review).toEqual({ state: 'not_reviewed', label: 'Not reviewed', overridden: false })
  })

  it('merges a fix-first PR without an override, at the reviewed commit', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'fix_first' })] })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('fix_first')
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'sha1' })
  })

  it('fails closed when the review cannot be read', async () => {
    db = makeDb({ fix_attempts: [attempt()] }, { failRead: (t) => (t === 'fix_reviews' ? 'connection reset' : null) })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(503)
    expect(res.json.error.code).toBe('REVIEW_UNAVAILABLE')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('merges as "not reviewed" only when the table does not exist yet (before the migration)', async () => {
    db = makeDb(
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
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
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
    db = makeDb({ fix_attempts: [attempt({ commit_sha: 'newer' })], fix_reviews: [review({ verdict: 'merge' })], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
    const res = await call('GET', `/v1/admin/fixes/${FIX}/timeline`)
    expect(res.json.data.review).toMatchObject({ state: 'stale', stale: true, verdict: 'merge' })
  })

  it('says "Not reviewed" for an attempt with no review', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [], fix_events: [], fix_dispatch_jobs: [], project_repos: [] })
    const res = await call('GET', `/v1/admin/fixes/${FIX}/timeline`)
    expect(res.json.data.review).toMatchObject({ state: 'not_reviewed', label: 'Not reviewed' })
  })
})

describe('POST /v1/admin/fixes/:id/review — re-run', () => {
  it('re-queues the review but KEEPS the hold: a merge right after is still a 409', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
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
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ status: 'queued' })] })
    expect((await call('POST', RERUN)).status).toBe(409)
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ status: 'running', started_at: new Date().toISOString() })] })
    const running = await call('POST', RERUN)
    expect(running.status).toBe(409)
    expect(running.json.error.code).toBe('REVIEW_IN_PROGRESS')
    // A run that died long ago may be re-queued.
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ status: 'running', started_at: '2026-01-01T00:00:00Z' })] })
    expect((await call('POST', RERUN)).status).toBe(202)
  })

  it('refuses viewers and a burst of re-runs', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    mocks.role.value = 'viewer'
    expect((await call('POST', RERUN)).status).toBe(403)
    mocks.role.value = 'member'
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSec: 1200 })
    const limited = await call('POST', RERUN)
    expect(limited.status).toBe(429)
    expect(db.tables.fix_reviews[0]).toMatchObject({ status: 'completed' })
  })

  it('refuses a merged PR', async () => {
    db = makeDb({ fix_attempts: [attempt({ pr_state: 'merged', merged_at: '2026-10-21T00:00:00Z' })], fix_reviews: [] })
    const res = await call('POST', RERUN)
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('PR_NOT_OPEN')
  })
})

describe('a hold cannot be unlinked, re-rolled or merged before the review (second review of #534)', () => {
  const OTHER = '3000000f-0000-4000-8000-0000000000bb'

  it('PATCH cannot retarget or clear the PR of a fix that has one, but can set it while unset', async () => {
    db = makeDb({ fix_attempts: [attempt({ commit_sha: 'sha1' })] })
    const retarget = await call('PATCH', `/v1/admin/fixes/${FIX}`, { pr_url: 'https://github.com/acme/app/pull/999' })
    expect(retarget.status).toBe(409)
    expect(retarget.json.error.code).toBe('PR_LINK_LOCKED')
    expect((await call('PATCH', `/v1/admin/fixes/${FIX}`, { pr_url: null })).status).toBe(409)
    expect((await call('PATCH', `/v1/admin/fixes/${FIX}`, { commit_sha: 'other' })).status).toBe(409)
    expect(db.tables.fix_attempts[0]).toMatchObject({ pr_url: 'https://github.com/acme/app/pull/195', commit_sha: 'sha1' })

    db = makeDb({ fix_attempts: [attempt({ pr_url: null, pr_number: null, commit_sha: null })] })
    const first = await call('PATCH', `/v1/admin/fixes/${FIX}`, { pr_url: 'https://github.com/acme/app/pull/196', commit_sha: 'c1' })
    expect(first.status).toBe(200)
    expect(db.tables.fix_attempts[0]).toMatchObject({ pr_url: 'https://github.com/acme/app/pull/196', commit_sha: 'c1' })
  })

  it('finds a hold by the PR\'s identity (repo + number) even when no fix attempt points at the PR any more', async () => {
    // The held fix was unlinked (its attempt now names another PR); a second
    // attempt with no review points at the held PR and tries to merge it.
    db = makeDb({
      fix_attempts: [
        attempt({ pr_url: 'https://github.com/acme/app/pull/999', pr_number: 999 }),
        attempt({ id: OTHER }),
      ],
      fix_reviews: [review({ pr_url: 'https://github.com/acme/app/pull/195' })],
    })
    const res = await call('POST', `/v1/admin/fixes/${OTHER}/merge`, {})
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('an API key cannot re-run a hold on the LIVE head, whatever commit_sha says; a person can; a new live head re-runs for anyone', async () => {
    // C2: a faked fix_attempts.commit_sha must not unlock a re-run.
    db = makeDb({ fix_attempts: [attempt({ commit_sha: 'faked-newer' })], fix_reviews: [review()] })
    mocks.auth.method = 'apiKey'
    const key = await call('POST', RERUN)
    expect(key.status).toBe(403)
    expect(key.json.error.code).toBe('RERUN_NEEDS_CONSOLE')
    expect(db.tables.fix_reviews[0]).toMatchObject({ status: 'completed', verdict: 'hold' })

    mocks.auth.method = 'jwt'
    expect((await call('POST', RERUN)).status).toBe(202)

    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review()] })
    mocks.head.sha = 'pushed-since'
    mocks.auth.method = 'apiKey'
    expect((await call('POST', RERUN)).status).toBe(202)
  })

  it('while the first review runs: an API key gets REVIEW_PENDING, a person merges after confirming', async () => {
    const pending = review({ status: 'running', verdict: null, head_sha: null, reviewed_at: null, started_at: new Date().toISOString() })
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [pending] })
    mocks.auth.method = 'apiKey'
    const key = await call('POST', MERGE, {})
    expect(key.status).toBe(409)
    expect(key.json.error.code).toBe('REVIEW_PENDING')

    mocks.auth.method = 'jwt'
    const unconfirmed = await call('POST', MERGE, {})
    expect(unconfirmed.status).toBe(409)
    expect(unconfirmed.json.error.code).toBe('REVIEW_PENDING')
    expect(mocks.merge).not.toHaveBeenCalled()

    const confirmed = await call('POST', MERGE, { confirmPendingReview: true })
    expect(confirmed.status).toBe(200)
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'sha1' })
    const meta = mocks.audit.mock.calls.find((c) => c[3] === 'fix.merge')?.[6]
    expect(meta).toMatchObject({ merged_before_review: true })
  })

  it('a review skipped for no key keeps today\'s behaviour, also for an API key', async () => {
    db = makeDb({
      fix_attempts: [attempt()],
      fix_reviews: [review({ status: 'skipped', verdict: null, head_sha: null, reviewed_at: null, skip_reason: 'no_anthropic_key' })],
    })
    mocks.auth.method = 'apiKey'
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(200)
    expect(res.json.data.review.state).toBe('skipped')
  })

  it('every merge path goes through the gated merge: only gated-merge.ts calls GitHub\'s merge', () => {
    const root = resolve(__dirname, '../../supabase/functions')
    const callers: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.ts') && /mergeGithubPullRequest\(/.test(readFileSync(full, 'utf8').replace(/export async function mergeGithubPullRequest\(/, ''))) {
          callers.push(relative(root, full))
        }
      }
    }
    walk(root)
    expect(callers).toEqual(['_shared/gated-merge.ts'])
  })
})

describe('cross-project and URL spelling (final review of #534)', () => {
  const X = '9000000f-0000-4000-8000-0000000000cc'
  const OTHER_FIX = '3000000f-0000-4000-8000-0000000000dd'

  it('the trailing-slash path: a second project cannot attach another spelling of a PR', async () => {
    db = makeDb({ fix_attempts: [attempt({ id: OTHER_FIX, pr_url: null, pr_number: null, commit_sha: null })] })
    const slash = await call('PATCH', `/v1/admin/fixes/${OTHER_FIX}`, { status: 'completed', pr_url: 'https://github.com/o/r/pull/5/' })
    expect(slash.status).toBe(200)
    // Accepted only in its canonical form, so uq_fix_attempts_pr_url sees the same string as every other spelling.
    expect(db.tables.fix_attempts[0]).toMatchObject({ pr_url: 'https://github.com/o/r/pull/5', pr_number: 5 })

    for (const bad of ['https://github.com/o/r/pulls/5', 'http://github.com/o/r/pull/5', 'https://gitlab.com/o/r/pull/5', 'https://github.com/o/r/pull/5/files/../x', 'not a url']) {
      db = makeDb({ fix_attempts: [attempt({ id: OTHER_FIX, pr_url: null, pr_number: null })] })
      const res = await call('PATCH', `/v1/admin/fixes/${OTHER_FIX}`, { pr_url: bad })
      expect(res.status).toBe(400)
      expect(res.json.error.code).toBe('INVALID_PR_URL')
    }
  })

  it('a fix attempt pointed at a repo the project does not have cannot merge it (403 REPO_NOT_IN_PROJECT)', async () => {
    // Project P's attempt names project X's repo o/r (the exact scenario: submit_fix_result
    // with a trailing slash, refresh_ci fills pr_number, merge_fix).
    db = makeDb({ fix_attempts: [attempt({ id: OTHER_FIX, pr_url: 'https://github.com/o/r/pull/5', pr_number: 5 })] })
    const res = await call('POST', `/v1/admin/fixes/${OTHER_FIX}/merge`, {})
    expect(res.status).toBe(403)
    expect(res.json.error.code).toBe('REPO_NOT_IN_PROJECT')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('another project\'s hold on the same PR blocks the merge (shared repo)', async () => {
    db = makeDb({
      fix_attempts: [attempt({ id: OTHER_FIX })],
      fix_reviews: [review({ id: 'rev-x', fix_attempt_id: 'fa-in-x', project_id: X })],
    })
    const res = await call('POST', `/v1/admin/fixes/${OTHER_FIX}/merge`, {})
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('an API key cannot write commit_sha once a PR is attached, even from unset (C2)', async () => {
    db = makeDb({ fix_attempts: [attempt({ commit_sha: null })] })
    mocks.auth.method = 'apiKey'
    const res = await call('PATCH', `/v1/admin/fixes/${FIX}`, { commit_sha: 'faked' })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('PR_LINK_LOCKED')
    expect(db.tables.fix_attempts[0].commit_sha).toBeNull()
  })

  it('W2: a merge verdict for an older head while the newer head\'s review runs is pending for an API key', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'merge', head_sha: 'old', status: 'queued' })] })
    mocks.head.sha = 'new'
    mocks.auth.method = 'apiKey'
    const key = await call('POST', MERGE, {})
    expect(key.status).toBe(409)
    expect(key.json.error.code).toBe('REVIEW_PENDING')
    mocks.auth.method = 'jwt'
    const confirmed = await call('POST', MERGE, { confirmPendingReview: true })
    expect(confirmed.status).toBe(200)
    expect(mocks.merge.mock.calls[0][3]).toMatchObject({ sha: 'new' })
  })

  it('a manual re-run of the same head does not block a merge verdict', async () => {
    db = makeDb({ fix_attempts: [attempt()], fix_reviews: [review({ verdict: 'merge', status: 'running' })] })
    mocks.auth.method = 'apiKey'
    expect((await call('POST', MERGE, {})).status).toBe(200)
  })
})

describe('a renamed repo (verification of 90fe9156)', () => {
  const OLD_URL = 'https://github.com/acme/old-app/pull/195'

  it('only the old name connected: the old-name URL gets 409 REPO_RENAMED and the hold under the new name is never bypassed', async () => {
    // The project still has the old name in the legacy settings column; GitHub
    // redirects acme/old-app to acme/app, where another project's review held the PR.
    mocks.base.id = 4242
    mocks.base.fullName = 'Acme/App'
    db = makeFakeDb({
      project_repos: [],
      project_settings: [{ project_id: P, github_repo_url: 'https://github.com/acme/old-app' }],
      fix_attempts: [attempt({ pr_url: OLD_URL })],
      fix_reviews: [review({ id: 'rev-new', fix_attempt_id: 'fa-elsewhere', project_id: '9000000f-0000-4000-8000-0000000000cc', repo_id: 4242 })],
    })
    mocks.auth.method = 'apiKey'
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REPO_RENAMED')
    expect(res.json.error.message).toContain('acme/app')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('a hold stored under a former name is found by GitHub repo id', async () => {
    mocks.base.id = 4242
    mocks.base.fullName = 'acme/app'
    db = makeDb({
      fix_attempts: [attempt()],
      fix_reviews: [review({ id: 'rev-old', fix_attempt_id: 'fa-elsewhere', project_id: '9000000f-0000-4000-8000-0000000000cc', repo: 'acme/old-app', pr_url: OLD_URL, repo_id: 4242 })],
    })
    const res = await call('POST', MERGE, {})
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('REVIEW_HOLD')
    expect(mocks.merge).not.toHaveBeenCalled()
  })

  it('both names connected: the old-name URL is gated and merged under the name GitHub uses now', async () => {
    mocks.base.id = 4242
    mocks.base.fullName = 'acme/app'
    db = makeFakeDb({
      project_repos: [...REPOS, { project_id: P, repo_url: 'https://github.com/acme/old-app', is_primary: false }],
      fix_attempts: [attempt({ pr_url: OLD_URL })],
      fix_reviews: [review({ fix_attempt_id: 'fa-elsewhere', project_id: '9000000f-0000-4000-8000-0000000000cc', repo_id: 4242 })],
    })
    const held = await call('POST', MERGE, {})
    expect(held.json.error.code).toBe('REVIEW_HOLD')

    db = makeFakeDb({
      project_repos: [...REPOS, { project_id: P, repo_url: 'https://github.com/acme/old-app', is_primary: false }],
      fix_attempts: [attempt({ pr_url: OLD_URL })],
    })
    const ok = await call('POST', MERGE, {})
    expect(ok.status).toBe(200)
    expect(mocks.merge.mock.calls[0][1]).toEqual({ owner: 'acme', repo: 'app' })
  })
})
