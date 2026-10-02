/**
 * FILE: packages/server/src/__tests__/fix-fixing-reconcile.test.ts
 * PURPOSE: Nothing sits in 'fixing' forever (2026-10-02, report 469f6962).
 *
 *          Before the close-handling deploy, a PR closed at 01:42 left its
 *          report in 'fixing' until 09:02: GitHub pull_request webhooks never
 *          reach Mushi, ci-sync did not read the PR, and once it did, the 1 h
 *          revisit gate delayed it again. These tests pin the second safety
 *          net — the sweep that looks at the REPORT side — and the ci-sync
 *          queue that no longer starves behind unreadable PRs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, eqValue, findQueries, hasFilter } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  dispatchPluginEventDetached: vi.fn(async () => undefined),
  notifyReportStatusTransition: vi.fn(async () => undefined),
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
vi.mock('../../supabase/functions/_shared/report-status-notify.ts', () => ({
  notifyReportStatusTransition: (...args: unknown[]) => mocks.notifyReportStatusTransition(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/integrations.ts', () => ({ resolveExternalIssue: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({ emitProductEvent: vi.fn(async () => undefined) }))
vi.mock('../../supabase/functions/_shared/sentry-resolve-back.ts', () => ({
  resolveLinkedSentryIssues: vi.fn(async () => undefined),
}))

import { reconcileStuckFixingReports } from '../../supabase/functions/_shared/fix-merge.ts'
import {
  decideFixingReport,
  FIX_STALLED_NO_LIVE_ATTEMPT,
  FIX_STALLED_PR_UNREADABLE,
  type FixingAttemptView,
} from '../../supabase/functions/_shared/fix-loop-status.ts'

const NOW = new Date('2026-10-02T09:00:00Z')
const HOURS_AGO = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const fixing = (over: Partial<{ updated_at: string; processing_error: string | null }> = {}) => ({
  status: 'fixing',
  updated_at: HOURS_AGO(7),
  processing_error: null,
  ...over,
})

const attempt = (over: Partial<FixingAttemptView> = {}): FixingAttemptView => ({
  id: 'fa-1',
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/mushi-mushi/pull/424',
  pr_state: 'closed',
  merged_at: null,
  created_at: HOURS_AGO(8),
  completed_at: HOURS_AGO(8),
  ...over,
})

describe('decideFixingReport', () => {
  it('reverts the 469f6962 shape: one completed attempt whose PR was closed unmerged', () => {
    expect(decideFixingReport({ report: fixing(), attempts: [attempt()], now: NOW })).toEqual({
      action: 'revert',
      processingError: FIX_STALLED_NO_LIVE_ATTEMPT,
    })
  })

  it('reverts when every attempt failed or ended without a PR', () => {
    const attempts = [
      attempt({ id: 'a', status: 'failed', pr_url: null, pr_state: null }),
      attempt({ id: 'b', status: 'completed_no_pr', pr_url: null, pr_state: null }),
    ]
    expect(decideFixingReport({ report: fixing(), attempts, now: NOW }).action).toBe('revert')
  })

  it('keeps a report whose PR is open or draft: merging is a human decision', () => {
    for (const pr_state of ['open', 'draft']) {
      expect(decideFixingReport({ report: fixing(), attempts: [attempt({ pr_state })], now: NOW })).toEqual({
        action: 'keep',
        reason: 'pr_open',
      })
    }
  })

  it('keeps a report while any attempt is queued or running (their timeouts live elsewhere)', () => {
    const attempts = [attempt(), attempt({ id: 'b', status: 'running', pr_url: null, pr_state: null })]
    expect(decideFixingReport({ report: fixing(), attempts, now: NOW })).toEqual({ action: 'keep', reason: 'attempt_live' })
  })

  it('finalizes a merged attempt whose bookkeeping never ran, ahead of every other rule', () => {
    const attempts = [attempt({ id: 'live', status: 'running' }), attempt({ id: 'm', pr_state: 'merged' })]
    expect(decideFixingReport({ report: fixing(), attempts, now: NOW })).toEqual({ action: 'finalize_merged', attemptId: 'm' })
    expect(
      decideFixingReport({ report: fixing(), attempts: [attempt({ id: 'm2', pr_state: null, merged_at: HOURS_AGO(1) })], now: NOW }),
    ).toEqual({ action: 'finalize_merged', attemptId: 'm2' })
  })

  it('trusts an unread PR for 24 h, then flags it without reverting (it may still be open)', () => {
    const fresh = attempt({ pr_state: null, completed_at: HOURS_AGO(23) })
    expect(decideFixingReport({ report: fixing(), attempts: [fresh], now: NOW })).toEqual({ action: 'keep', reason: 'attempt_live' })

    const stale = attempt({ pr_state: null, completed_at: HOURS_AGO(25) })
    expect(decideFixingReport({ report: fixing(), attempts: [stale], now: NOW })).toEqual({
      action: 'flag_unreadable',
      attemptId: 'fa-1',
      processingError: FIX_STALLED_PR_UNREADABLE,
    })
    // Flagged once; the next tick does not rewrite it.
    expect(
      decideFixingReport({ report: fixing({ processing_error: FIX_STALLED_PR_UNREADABLE }), attempts: [stale], now: NOW }),
    ).toEqual({ action: 'keep', reason: 'already_flagged' })
  })

  it('waits out the grace period after the report last changed', () => {
    expect(
      decideFixingReport({ report: fixing({ updated_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() }), attempts: [attempt()], now: NOW }),
    ).toEqual({ action: 'keep', reason: 'grace' })
  })

  it('leaves a report a human put in fixing with no attempt, and anything not in fixing', () => {
    expect(decideFixingReport({ report: fixing(), attempts: [], now: NOW })).toEqual({ action: 'keep', reason: 'no_attempts' })
    expect(decideFixingReport({ report: { ...fixing(), status: 'fixed' }, attempts: [attempt()], now: NOW })).toEqual({
      action: 'keep',
      reason: 'not_fixing',
    })
  })
})

describe('reconcileStuckFixingReports', () => {
  beforeEach(() => {
    mocks.dispatchPluginEventDetached.mockClear()
    mocks.notifyReportStatusTransition.mockClear()
  })

  const REPORT = {
    id: 'rep-469',
    project_id: 'proj-1',
    status: 'fixing',
    updated_at: HOURS_AGO(7),
    processing_error: null,
    category: 'visual',
    severity: 'medium',
    stage1_classification: null,
    fix_pr_url: 'https://github.com/kensaurus/mushi-mushi/pull/424',
  }
  const ROW = { ...attempt(), project_id: 'proj-1', report_id: 'rep-469', agent: 'claude_code', branch: 'b', commit_sha: 'c', pr_number: 424 }

  function scripted(opts: { attempts: unknown[]; report?: Record<string, unknown> }) {
    return createFakeDb((q) => {
      if (q.table === 'reports' && q.op === 'select' && hasFilter(q, 'lt', 'updated_at')) {
        return { data: [opts.report ?? REPORT] }
      }
      if (q.table === 'fix_attempts' && q.op === 'select') return { data: opts.attempts }
      if (q.table === 'reports' && q.op === 'select') {
        return { data: { id: REPORT.id, status: 'fixing', reporter_token_hash: 'rk1_real' } }
      }
      if (q.table === 'reports' && q.op === 'update') return { data: { id: REPORT.id } }
      if (q.table === 'fix_attempts' && q.op === 'update') return { data: { id: ROW.id } }
      return { data: null }
    })
  }

  it('scans only reports parked in fixing past the grace period, oldest first', async () => {
    const { db, queries } = scripted({ attempts: [ROW] })
    await reconcileStuckFixingReports(db, NOW)
    const scan = findQueries(queries, 'reports', 'select')[0]
    expect(eqValue(scan, 'status')).toBe('fixing')
    expect(scan.filters.find((f) => f.method === 'lt')?.args).toEqual(['updated_at', '2026-10-02T08:30:00.000Z'])
    expect(scan.filters.filter((f) => f.method === 'order').map((f) => f.args)).toEqual([
      ['updated_at', { ascending: true }],
      ['id', { ascending: true }],
    ])
    expect(scan.filters.find((f) => f.method === 'range')?.args).toEqual([0, 49])
  })

  it('reverts a closed-PR report to its pre-fix status, guarded on fixing, and tells plugins', async () => {
    const { db, queries } = scripted({ attempts: [ROW] })
    const summary = await reconcileStuckFixingReports(db, NOW)
    expect(summary).toEqual({ scanned: 1, finalized: 0, reverted: 1, flagged: 0 })

    const update = findQueries(queries, 'reports', 'update')[0]
    expect(update.payload).toEqual({
      status: 'classified',
      processing_error: FIX_STALLED_NO_LIVE_ATTEMPT,
      fix_pr_url: null,
      fix_branch: null,
    })
    expect(eqValue(update, 'status')).toBe('fixing')
    expect(eqValue(update, 'project_id')).toBe('proj-1')
    expect(mocks.dispatchPluginEventDetached).toHaveBeenCalledWith(db, 'proj-1', 'report.status_changed', {
      report: { id: 'rep-469', status: 'classified' },
      previousStatus: 'fixing',
      actor: { kind: 'system' },
    })
  })

  it('does not count or announce a revert another writer already beat it to', async () => {
    const { db } = createFakeDb((q) => {
      if (q.table === 'reports' && q.op === 'select') return { data: [REPORT] }
      if (q.table === 'fix_attempts' && q.op === 'select') return { data: [ROW] }
      return { data: null }
    })
    expect(await reconcileStuckFixingReports(db, NOW)).toEqual({ scanned: 1, finalized: 0, reverted: 0, flagged: 0 })
    expect(mocks.dispatchPluginEventDetached).not.toHaveBeenCalled()
  })

  it('finishes a merge whose bookkeeping crashed: report fixed, reporter notified', async () => {
    const merged = { ...ROW, pr_state: 'merged', merged_at: HOURS_AGO(2) }
    const { db, queries } = scripted({ attempts: [merged] })
    const summary = await reconcileStuckFixingReports(db, NOW)
    expect(summary.finalized).toBe(1)
    const fixed = findQueries(queries, 'reports', 'update').find((q) => (q.payload as { status?: string }).status === 'fixed')
    expect(fixed).toBeDefined()
    expect(mocks.notifyReportStatusTransition).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ reportId: 'rep-469', previousStatus: 'fixing', newStatus: 'fixed' }),
    )
  })

  it('flags an unreadable PR on the report without changing its status', async () => {
    const unread = { ...ROW, pr_state: null, completed_at: HOURS_AGO(30) }
    const { db, queries } = scripted({ attempts: [unread] })
    expect((await reconcileStuckFixingReports(db, NOW)).flagged).toBe(1)
    const update = findQueries(queries, 'reports', 'update')[0]
    expect(update.payload).toEqual({ processing_error: FIX_STALLED_PR_UNREADABLE })
    expect(eqValue(update, 'status')).toBe('fixing')
  })

  it('reaches a stuck report behind more than a page of reports waiting on open PRs', async () => {
    const reports = Array.from({ length: 60 }, (_, i) => ({
      ...REPORT,
      id: `open-${String(i).padStart(2, '0')}`,
      updated_at: HOURS_AGO(30 - i * 0.01),
    }))
    reports.push({ ...REPORT, id: 'stuck', updated_at: HOURS_AGO(1) })
    const live = new Set(reports.map((r) => r.id))
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'reports' && q.op === 'select') {
        const [from, to] = q.filters.find((f) => f.method === 'range')!.args as [number, number]
        return { data: reports.filter((r) => live.has(r.id)).slice(from, to + 1) }
      }
      if (q.table === 'fix_attempts' && q.op === 'select') {
        const ids = q.filters.find((f) => f.method === 'in')!.args[1] as string[]
        return {
          data: ids.map((id) => ({ ...ROW, id: `fa-${id}`, report_id: id, pr_state: id === 'stuck' ? 'closed' : 'open' })),
        }
      }
      if (q.table === 'reports' && q.op === 'update') {
        const id = eqValue(q, 'id') as string
        live.delete(id)
        return { data: { id } }
      }
      return { data: null }
    })
    const summary = await reconcileStuckFixingReports(db, NOW)
    expect(summary).toEqual({ scanned: 61, finalized: 0, reverted: 1, flagged: 0 })
    expect(live.has('stuck')).toBe(false)
    const pages = findQueries(queries, 'reports', 'select').map((q) => q.filters.find((f) => f.method === 'range')!.args)
    expect(pages).toEqual([
      [0, 49],
      [50, 99],
    ])
  })

  it('ignores attempts from another project that share the report id', async () => {
    const foreign = { ...ROW, project_id: 'proj-other', pr_state: 'open' }
    const { db } = scripted({ attempts: [foreign] })
    // With the foreign open PR filtered out there are no attempts left: a
    // human-owned 'fixing', left alone.
    expect(await reconcileStuckFixingReports(db, NOW)).toEqual({ scanned: 1, finalized: 0, reverted: 0, flagged: 0 })
  })
})

describe('ci-sync sweep queue', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/ci-sync/index.ts'), 'utf8')

  it('is one round-robin queue on updated_at, stamped on every visit', () => {
    expect(src.match(/\.or\('pr_state\.is\.null,pr_state\.in\.\(open,draft\)'\)/g)?.length).toBe(1)
    expect(src).toMatch(/\.lt\('updated_at', cutoff\)\s*\.order\('updated_at', \{ ascending: true \}\)/)
    expect(src).toMatch(/await syncOne\(db, attempt\)\s*await db\.from\('fix_attempts'\)\.update\(\{ updated_at: /)
    // The starving "never synced first" query is gone.
    expect(src).not.toMatch(/\.is\('check_run_updated_at', null\)/)
  })

  it('selects PRs by URL so attempts without a stored number are still swept', () => {
    expect(src).toMatch(/\.not\('pr_url', 'is', null\)/)
    expect(src).not.toMatch(/\.not\('pr_number', 'is', null\)/)
  })

  it('revisits an open PR within 15 minutes and runs the fixing reconciler after the PR pass', () => {
    expect(src).toMatch(/const SWEEP_REVISIT_MS = 15 \* 60_000/)
    expect(src).toMatch(/const fixing = await reconcileStuckFixingReports\(db\)/)
  })
})

describe('fix_attempts_stuck_reaper migration', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261002135400_fix_dispatch_jobs_stuck_reaper.sql'),
    'utf8',
  )

  it('fails in-edge jobs stuck running, leaving every long-lived handoff alone', () => {
    expect(sql).toMatch(/WHERE\s+j\.status = 'running'\s+AND\s+COALESCE\(j\.started_at, j\.created_at\) < now\(\) - interval '30 minutes'/)
    const dead = sql.slice(sql.indexOf('WITH dead AS'), sql.indexOf('FOR UPDATE OF j SKIP LOCKED'))
    expect(dead).toMatch(/fa\.id IS NULL/)
    // Cloud kinds: the list must cover every CloudAgentKind in agent-adapters.ts.
    const adapters = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/agent-adapters.ts'), 'utf8')
    const kinds = adapters.match(/export type CloudAgentKind = ([^\n]+)/)![1].match(/'([a-z_]+)'/g)!.map((k) => k.slice(1, -1))
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) expect(dead).toContain(`'${kind}'`)
    // Any attempt that handed work to something outliving the worker.
    for (const col of ['cursor_agent_id', 'github_task_id', 'claude_dispatch_event_id', 'claude_workflow_run_id', 'external_agent_ref']) {
      expect(dead).toContain(`fa.${col} IS NULL`)
    }
  })

  it('fails jobs the sweeper re-sent for an hour', () => {
    expect(sql).toMatch(/j\.status = 'queued'\s+AND\s+j\.created_at < now\(\) - interval '60 minutes'/)
  })

  it('reaps jobs in their own statements before the attempt pass, so the attempt pass sees them terminal', () => {
    const jobsFailed = sql.indexOf("SET    status = 'failed',\n         error = 'Reaped: the fix worker stopped")
    const queuedFailed = sql.indexOf("error = 'Reaped: no fix worker picked this job up")
    const attempts = sql.indexOf('WITH stuck AS')
    expect(jobsFailed).toBeGreaterThan(0)
    expect(queuedFailed).toBeGreaterThan(jobsFailed)
    expect(attempts).toBeGreaterThan(queuedFailed)
    expect(sql.match(/GET DIAGNOSTICS/g)?.length).toBe(2)
  })

  it('stays service-only', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fix_attempts_stuck_reaper\(\) FROM PUBLIC, anon, authenticated;/)
  })
})
