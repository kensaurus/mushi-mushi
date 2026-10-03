/**
 * FILE: packages/server/src/__tests__/fix-merged-at.test.ts
 * PURPOSE: fix_attempts.merged_at is GitHub's merge time, not the moment
 *          Mushi noticed the merge (completeness gap #10 review).
 *
 *          report-deploy-live places each deploy_drift run before or after
 *          merged_at. Without the GitHub App, ci-sync notices a merge minutes
 *          later, so a noticed-at stamp would file a collector run taken
 *          inside that lag as "before the merge" and call a live fix not live.
 *          Every path that has GitHub's `merged_at` passes it through.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, findQueries } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  fetchPullRequest: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  fetchPullRequest: (...args: unknown[]) => mocks.fetchPullRequest(...args),
  markPullRequestReady: vi.fn(async () => ({ ok: true })),
  parseGithubRepoUrl: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({ dispatchPluginEventDetached: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({ notifyTeamFixEvent: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/report-status-notify.ts', () => ({ notifyReportStatusTransition: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/integrations.ts', () => ({ resolveExternalIssue: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({ emitProductEvent: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/sentry-resolve-back.ts', () => ({ resolveLinkedSentryIssues: vi.fn(async () => undefined) }))

import { finalizeFixMerge, mergeGithubPullRequest, resolveMergedAt } from '../../supabase/functions/_shared/fix-merge.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

const ATTEMPT = {
  id: 'fa-1',
  project_id: 'proj-1',
  report_id: 'rep-1',
  agent: 'claude_code',
  branch: 'bugfix/x',
  commit_sha: 'abc1234',
  pr_url: 'https://github.com/acme/app/pull/12',
  pr_number: 12,
  merged_at: null,
}

function scripted() {
  return createFakeDb((q) => {
    if (q.table === 'fix_attempts' && q.op === 'update') return { data: { id: ATTEMPT.id } }
    if (q.table === 'reports' && q.op === 'select') return { data: { id: ATTEMPT.report_id, status: 'fixed', reporter_token_hash: null } }
    return { data: null }
  })
}

function mergedAtWritten(queries: ReturnType<typeof scripted>['queries']): unknown {
  const update = findQueries(queries, 'fix_attempts', 'update').find((q) => (q.payload as { merged_at?: unknown }).merged_at !== undefined)
  return (update?.payload as { merged_at?: unknown } | undefined)?.merged_at
}

describe('resolveMergedAt', () => {
  const NOW = new Date('2026-10-03T12:00:00Z')

  it('keeps GitHub\'s merge time when it is a real past time', () => {
    expect(resolveMergedAt('2026-10-03T11:47:12Z', NOW)).toBe('2026-10-03T11:47:12.000Z')
  })

  it('falls back to now for a missing, unparseable or future time', () => {
    expect(resolveMergedAt(null, NOW)).toBe(NOW.toISOString())
    expect(resolveMergedAt(undefined, NOW)).toBe(NOW.toISOString())
    expect(resolveMergedAt('not a date', NOW)).toBe(NOW.toISOString())
    expect(resolveMergedAt('2026-10-03T12:30:00Z', NOW)).toBe(NOW.toISOString())
  })
})

describe('finalizeFixMerge', () => {
  it('stores GitHub\'s merged_at, not the time Mushi noticed the merge', async () => {
    const { db, queries } = scripted()
    await finalizeFixMerge(db as never, ATTEMPT, { prUrl: ATTEMPT.pr_url, prNumber: 12, mergedAt: '2026-10-03T03:20:00Z' })
    expect(mergedAtWritten(queries)).toBe('2026-10-03T03:20:00.000Z')
  })

  it('stores the current time when the caller has no GitHub merge time', async () => {
    const before = Date.now()
    const { db, queries } = scripted()
    await finalizeFixMerge(db as never, ATTEMPT, { prUrl: ATTEMPT.pr_url, prNumber: 12 })
    const written = Date.parse(String(mergedAtWritten(queries)))
    expect(written).toBeGreaterThanOrEqual(before)
    expect(written).toBeLessThanOrEqual(Date.now())
  })
})

describe('mergeGithubPullRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    mocks.fetchPullRequest.mockReset()
  })

  it('returns GitHub\'s merge time for a PR that was already merged', async () => {
    mocks.fetchPullRequest.mockResolvedValue({ number: 12, draft: false, state: 'closed', merged: true, mergedAt: '2026-10-02T22:10:00Z' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Pull Request has already been merged' }), { status: 405 })))
    const out = await mergeGithubPullRequest('tok', { owner: 'acme', repo: 'app' }, 12)
    expect(out).toMatchObject({ merged: true, alreadyMerged: true, mergedAt: '2026-10-02T22:10:00Z' })
  })
})

describe('every merge-detection path passes GitHub\'s merge time', () => {
  it('fetchPullRequest reads merged_at from the GitHub pull', () => {
    expect(read('_shared/github.ts')).toMatch(/mergedAt: body\.merged_at \?\? null,/)
  })

  it('ci-sync passes the polled PR\'s merged_at', () => {
    expect(read('ci-sync/index.ts')).toMatch(/finalizeFixMerge\(db, attempt, \{[\s\S]{0,200}?mergedAt: pr\.mergedAt \?\? null,/)
  })

  it('the pull_request webhook passes the payload\'s merged_at', () => {
    expect(read('webhooks-github-indexer/index.ts')).toMatch(/finalizeFixMerge\(db, attempt, \{[\s\S]{0,200}?mergedAt: payload\.pull_request\?\.merged_at \?\? null,/)
  })

  it('the console merge keeps GitHub\'s time for a PR that was already merged', () => {
    expect(read('api/routes/query-fixes-repo.ts')).toMatch(/mergedAt: mergeResult\.alreadyMerged \? mergeResult\.mergedAt \?\? null : null,/)
  })
})
