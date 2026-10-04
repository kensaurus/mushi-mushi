/**
 * FILE: packages/server/src/__tests__/fix-pr-closed-unmerged.test.ts
 * PURPOSE: Regression guard for report 469f6962 (2026-10-02).
 *
 *          PR #424 was closed without a merge. 33 minutes later the report was
 *          still 'fixing', the attempt had pr_state NULL, and the Act stage
 *          said "Awaiting merge": the webhook never arrived, and neither
 *          ci-sync nor refresh-ci looked at the PR itself. These tests pin
 *          the shared close bookkeeping and the three paths that call it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, eqValue, findQueries, hasFilter } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  dispatchPluginEventDetached: vi.fn(async () => undefined),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  fetchPullRequest: vi.fn(),
  markPullRequestReady: vi.fn(),
  parseGithubRepoUrl: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: (...args: unknown[]) => mocks.dispatchPluginEventDetached(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({ notifyTeamFixEvent: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/report-status-notify.ts', () => ({ notifyReportStatusTransition: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/integrations.ts', () => ({ resolveExternalIssue: vi.fn() }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({ emitProductEvent: vi.fn() }))
vi.mock('../../supabase/functions/_shared/sentry-resolve-back.ts', () => ({ resolveLinkedSentryIssues: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({ keepAlive: () => undefined }))

import { finalizeFixClosedUnmerged, finalizeFixMerge } from '../../supabase/functions/_shared/fix-merge.ts'
import {
  fixFailureBucket,
  isFixCountedFailed,
  preFixReportStatus,
  prLifecycleFrom,
  shouldRevertReportOnPrClose,
} from '../../supabase/functions/_shared/fix-loop-status.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

const ATTEMPT = {
  id: 'fa-424',
  project_id: 'proj-1',
  report_id: 'rep-469',
  agent: 'claude_code',
  branch: 'bugfix/MUSHI-469f6962-visual',
  commit_sha: 'abc1234',
  pr_url: 'https://github.com/kensaurus/mushi-mushi/pull/424',
  pr_number: 424,
  merged_at: null,
}

describe('fix-loop-status pure rules', () => {
  it('maps a GitHub PR to the pr_state CHECK values', () => {
    expect(prLifecycleFrom({ merged: true, state: 'closed' })).toBe('merged')
    expect(prLifecycleFrom({ merged: false, state: 'closed' })).toBe('closed')
    expect(prLifecycleFrom({ state: 'open', draft: true })).toBe('draft')
    expect(prLifecycleFrom({ state: 'open' })).toBe('open')
  })

  it('sends a classified report back to the triage queue, an unclassified one to new', () => {
    expect(preFixReportStatus({ category: 'visual', severity: 'low' })).toBe('classified')
    expect(preFixReportStatus({ stage1_classification: { category: 'bug' } })).toBe('classified')
    expect(preFixReportStatus({})).toBe('new')
  })

  it('only reverts a report that is still parked in fixing with no other live attempt', () => {
    expect(shouldRevertReportOnPrClose({ reportStatus: 'fixing', otherOpenAttempts: 0 })).toBe(true)
    expect(shouldRevertReportOnPrClose({ reportStatus: 'fixing', otherOpenAttempts: 1 })).toBe(false)
    expect(shouldRevertReportOnPrClose({ reportStatus: 'fixed', otherOpenAttempts: 0 })).toBe(false)
    expect(shouldRevertReportOnPrClose({ reportStatus: 'dismissed', otherOpenAttempts: 0 })).toBe(false)
  })

  it('counts red-CI and closed-unmerged PRs as failed, merged ones never', () => {
    expect(isFixCountedFailed({ status: 'failed' })).toBe(true)
    expect(isFixCountedFailed({ status: 'skipped_no_context' })).toBe(true)
    // The QA case: completed attempt, PR open, CI failure.
    expect(isFixCountedFailed({ status: 'completed', pr_url: 'u', check_run_conclusion: 'failure' })).toBe(true)
    expect(isFixCountedFailed({ status: 'completed', pr_url: 'u', pr_state: 'closed' })).toBe(true)
    expect(isFixCountedFailed({ status: 'completed', pr_url: 'u', check_run_conclusion: 'success' })).toBe(false)
    expect(
      isFixCountedFailed({ status: 'completed', pr_url: 'u', pr_state: 'merged', check_run_conclusion: 'failure' }),
    ).toBe(false)
  })

  it('buckets PR failures by why they are blocked when the worker set no category', () => {
    expect(fixFailureBucket({ status: 'failed', failure_category: 'sandbox_timeout' })).toBe('sandbox_timeout')
    expect(fixFailureBucket({ status: 'completed', pr_url: 'u', pr_state: 'closed' })).toBe('pr_closed_unmerged')
    expect(fixFailureBucket({ status: 'completed', pr_url: 'u' })).toBe('ci_failed')
    expect(fixFailureBucket({ status: 'failed' })).toBe('unknown')
  })

  // Since 2026-10-04 both count per REPORT from its current state
  // (fix-report-truth.ts, which applies isFixCountedFailed to each report's
  // latest attempt), never per attempt.
  it('/fixes/stats and /fixes/summary count failures with the shared rule', () => {
    const src = read('api/routes/query-fixes-repo.ts')
    expect(src.match(/summarizeFixTruths\(truths\.values\(\)\)/g)?.length).toBe(2)
    expect(src).not.toMatch(/const failed = (attempts|list)\.filter\(/)
  })
})

describe('finalizeFixClosedUnmerged', () => {
  beforeEach(() => mocks.dispatchPluginEventDetached.mockClear())

  function scripted(opts: { report: Record<string, unknown> | null; otherOpen?: number; alreadyClosed?: boolean }) {
    return createFakeDb((q) => {
      if (q.table === 'fix_attempts' && q.op === 'update') {
        return { data: opts.alreadyClosed ? null : { id: ATTEMPT.id } }
      }
      if (q.table === 'fix_attempts' && q.op === 'select') return { data: null, count: opts.otherOpen ?? 0 } as never
      if (q.table === 'reports' && q.op === 'select') return { data: opts.report }
      if (q.table === 'reports' && q.op === 'update') return { data: { id: ATTEMPT.report_id } }
      return { data: null }
    })
  }

  it('marks the attempt closed, writes one timeline event and reverts the report to classified', async () => {
    const { db, queries } = scripted({
      report: { id: ATTEMPT.report_id, status: 'fixing', category: 'visual', severity: 'low', fix_pr_url: ATTEMPT.pr_url },
    })
    const res = await finalizeFixClosedUnmerged(db, ATTEMPT, {
      prNumber: 424,
      closedAt: '2026-10-02T02:10:00Z',
      source: 'ci_sync',
    })
    expect(res).toEqual({ justClosed: true, reportStatus: 'classified' })

    const attemptUpdate = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(attemptUpdate.payload).toMatchObject({ pr_state: 'closed' })
    // Never touches a merged row.
    expect(hasFilter(attemptUpdate, 'is', 'merged_at')).toBe(true)

    const [event] = findQueries(queries, 'fix_events', 'insert')
    expect(event.payload).toMatchObject({
      kind: 'pr_state_changed',
      status: 'fail',
      label: 'PR closed without merge',
      detail: '#424',
      at: '2026-10-02T02:10:00Z',
    })

    const reportUpdate = findQueries(queries, 'reports', 'update')[0]
    expect(reportUpdate.payload).toMatchObject({ status: 'classified', fix_pr_url: null, fix_branch: null })
    // Guarded on 'fixing' so a human's later status change wins.
    expect(eqValue(reportUpdate, 'status')).toBe('fixing')
    expect(mocks.dispatchPluginEventDetached).toHaveBeenCalledWith(
      db,
      ATTEMPT.project_id,
      'report.status_changed',
      expect.objectContaining({ previousStatus: 'fixing' }),
    )
  })

  it('is idempotent: an already-closed attempt emits no second event', async () => {
    const { db, queries } = scripted({
      alreadyClosed: true,
      report: { id: ATTEMPT.report_id, status: 'classified', category: 'visual' },
    })
    const res = await finalizeFixClosedUnmerged(db, ATTEMPT, { source: 'webhook' })
    expect(res.justClosed).toBe(false)
    expect(findQueries(queries, 'fix_events', 'insert')).toHaveLength(0)
    expect(findQueries(queries, 'reports', 'update')).toHaveLength(0)
  })

  it('leaves the report in fixing while another attempt is still live', async () => {
    const { db, queries } = scripted({
      otherOpen: 1,
      report: { id: ATTEMPT.report_id, status: 'fixing', category: 'visual' },
    })
    const res = await finalizeFixClosedUnmerged(db, ATTEMPT, { source: 'ci_sync' })
    expect(res.reportStatus).toBe('fixing')
    expect(findQueries(queries, 'reports', 'update')).toHaveLength(0)
  })

  it('does not overwrite a report a human already moved', async () => {
    const { db, queries } = scripted({ report: { id: ATTEMPT.report_id, status: 'dismissed' } })
    await finalizeFixClosedUnmerged(db, ATTEMPT, { source: 'webhook' })
    expect(findQueries(queries, 'reports', 'update')).toHaveLength(0)
  })
})

describe('finalizeFixMerge on a cloud agent PR merged before the agent finished', () => {
  it('closes the still-open attempt and its job, so the poller stops and its 24 h expiry cannot report a merged fix as failed', async () => {
    const { db, queries } = createFakeDb((q) => (q.table === 'fix_attempts' && q.op === 'update' ? { data: { id: ATTEMPT.id } } : { data: null }))
    await finalizeFixMerge(db as never, { ...ATTEMPT, agent: 'github_cloud_agent' } as never, { prUrl: ATTEMPT.pr_url, prNumber: 424 })
    const close = findQueries(queries, 'fix_attempts', 'update').find((q) => (q.payload as { status?: string }).status === 'completed')
    expect(close).toBeDefined()
    expect(eqValue(close!, 'id')).toBe(ATTEMPT.id)
    // Only an attempt that is still open; a finished one keeps its status.
    expect(close!.filters).toContainEqual({ method: 'in', args: ['status', ['running', 'queued', 'dispatched', 'pending']] })
    const job = findQueries(queries, 'fix_dispatch_jobs', 'update')[0]
    expect(job.payload).toMatchObject({ status: 'completed', pr_url: ATTEMPT.pr_url })
    expect(hasFilter(job, 'in', 'status')).toBe(true)
  })
})

describe('every PR-lifecycle path uses the shared close bookkeeping', () => {
  it('ci-sync reads the PR, finalizes merged and closed PRs, and drops ended PRs from the sweep', () => {
    const src = read('ci-sync/index.ts')
    expect(src).toMatch(/fetchPullRequest\(/)
    expect(src).toMatch(/finalizeFixClosedUnmerged\(/)
    expect(src).toMatch(/finalizeFixMerge\(/)
    // The sweep queue (one round-robin query since 2026-10-02) skips merged / closed PRs.
    expect(src.match(/\.or\('pr_state\.is\.null,pr_state\.in\.\(open,draft\)'\)/g)?.length).toBe(1)
    expect(src).toMatch(/\.is\('merged_at', null\)\s*\.or\('pr_state\.is\.null,pr_state\.in\.\(open,draft\)'\)/)
  })

  it('the pull_request.closed webhook routes unmerged closes through the shared helper', () => {
    const src = read('webhooks-github-indexer/index.ts')
    expect(src).toMatch(/if \(newState === 'closed'\) \{\s*const closed = await finalizeFixClosedUnmerged\(/)
  })

  it('refresh-ci returns the PR state it just synced', () => {
    const src = read('api/routes/query-fixes-repo.ts')
    expect(src).toMatch(/check_run_status, check_run_conclusion, check_run_updated_at, pr_state, merged_at/)
  })
})
