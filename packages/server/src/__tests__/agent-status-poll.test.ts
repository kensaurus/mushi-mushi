/**
 * FILE: agent-status-poll.test.ts
 * PURPOSE: The cloud-agent poller: candidate selection window (2 min … 24 h,
 *          open, no PR, 20 per tick), working / completed / failed
 *          transitions through the REAL applyCloudAgentOutcome, branch
 *          learning while still working, the 24 h give-up, and vendor
 *          errors leaving the row for the next tick.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeDb, findQueries, hasFilter, type FakeQuery } from './__stubs__/fake-query-recorder.ts'

const mocks = vi.hoisted(() => ({
  notifyTeamFixEvent: vi.fn(async () => undefined),
  dispatchPluginEventDetached: vi.fn(async () => undefined),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: async () => null }))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({ parseGithubRepoUrl: () => null }))
vi.mock('../../supabase/functions/_shared/github-pr.ts', () => ({
  generateCursorCloudBranchName: (id: string) => `bugfix/MUSHI-${id}-cursor-cloud`,
  validateFixBranchName: () => undefined,
}))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({
  notifyTeamFixEvent: (...args: unknown[]) => mocks.notifyTeamFixEvent(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: (...args: unknown[]) => mocks.dispatchPluginEventDetached(...(args as [])),
}))

import { POLL_BATCH, POLL_MAX_AGE_MS, POLL_MIN_AGE_MS, runAgentStatusPoll } from '../../supabase/functions/agent-status-poll/index.ts'
import type { CloudAgentAdapter, CloudPollResult } from '../../supabase/functions/_shared/agent-adapters.ts'

const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REPORT = '0f7f2b1a-1111-4222-8333-444455556666'
const NOW = new Date('2026-09-12T12:00:00Z')

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fa-1',
    project_id: PROJECT,
    report_id: REPORT,
    agent: 'cursor_cloud',
    status: 'running',
    pr_url: null,
    branch_name: null,
    cursor_agent_id: 'bc-1',
    cursor_run_id: 'run_1',
    external_agent_ref: { kind: 'cursor_cloud' },
    started_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    ...overrides,
  }
}

function pollDb(open: unknown[], stale: unknown[] = []) {
  return createFakeDb((q: FakeQuery) => {
    if (q.table === 'fix_attempts' && q.op === 'select') {
      // The stale scan has lt(started_at) only; the open scan adds gte(started_at).
      return { data: hasFilter(q, 'gte', 'started_at') ? open : stale }
    }
    if (q.table === 'fix_attempts' && q.op === 'update') return { data: [{ id: 'fa-1' }] }
    return { data: null }
  })
}

function fakeAdapter(poll: () => Promise<CloudPollResult>): CloudAgentAdapter {
  return { kind: 'cursor_cloud', dispatch: vi.fn(), poll }
}

beforeEach(() => {
  mocks.notifyTeamFixEvent.mockClear()
  mocks.dispatchPluginEventDetached.mockClear()
})

describe('runAgentStatusPoll — selection', () => {
  it('scans open cloud attempts without a PR inside the 2 min … 24 h window, oldest first, 20 per tick', async () => {
    const { db, queries } = pollDb([])
    await runAgentStatusPoll(db, { now: NOW, adapterFor: () => fakeAdapter(async () => ({ status: 'working' })) })
    const scans = findQueries(queries, 'fix_attempts', 'select')
    expect(scans).toHaveLength(2)
    const open = scans.find((q) => hasFilter(q, 'gte', 'started_at'))!
    expect(open.filters).toContainEqual({ method: 'in', args: ['agent', ['cursor_cloud', 'github_cloud_agent']] })
    expect(open.filters).toContainEqual({ method: 'is', args: ['pr_url', null] })
    expect(open.filters).toContainEqual({ method: 'lt', args: ['started_at', new Date(NOW.getTime() - POLL_MIN_AGE_MS).toISOString()] })
    expect(open.filters).toContainEqual({ method: 'gte', args: ['started_at', new Date(NOW.getTime() - POLL_MAX_AGE_MS).toISOString()] })
    expect(open.filters).toContainEqual({ method: 'limit', args: [POLL_BATCH] })
    expect(POLL_BATCH).toBe(20)
  })
})

describe('runAgentStatusPoll — transitions', () => {
  it('working: no outcome, but a learned branch is persisted for the indexer', async () => {
    const { db, queries } = pollDb([attempt()])
    const summary = await runAgentStatusPoll(db, {
      now: NOW,
      adapterFor: () => fakeAdapter(async () => ({ status: 'working', branch: 'copilot/learned', ref: { runStatus: 'RUNNING' } })),
    })
    expect(summary).toMatchObject({ scanned: 1, working: 1, prOpened: 0, failed: 0, errors: 0 })
    const learned = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(learned.payload).toMatchObject({ branch_name: 'copilot/learned', external_agent_ref: expect.objectContaining({ runStatus: 'RUNNING', last_poll_status: 'working' }) })
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')).toHaveLength(0)
    expect(mocks.notifyTeamFixEvent).not.toHaveBeenCalled()
  })

  it('completed + prUrl: PR written (guarded on pr_url IS NULL), job completed, team notified once', async () => {
    const { db, queries } = pollDb([attempt()])
    const summary = await runAgentStatusPoll(db, {
      now: NOW,
      adapterFor: () => fakeAdapter(async () => ({ status: 'completed', prUrl: 'https://github.com/o/r/pull/7', branch: 'b', summary: 'done' })),
    })
    expect(summary).toMatchObject({ scanned: 1, prOpened: 1, working: 0 })
    const prWrite = findQueries(queries, 'fix_attempts', 'update').find((q) => (q.payload as { pr_url?: string }).pr_url)!
    expect(prWrite.payload).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/7', pr_state: 'open' })
    expect(prWrite.filters).toContainEqual({ method: 'is', args: ['pr_url', null] })
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')[0].payload).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/7' })
    expect(findQueries(queries, 'reports', 'update')[0].payload).toMatchObject({ fix_pr_url: 'https://github.com/o/r/pull/7', status: 'fixing' })
    expect(mocks.notifyTeamFixEvent).toHaveBeenCalledTimes(1)
    expect(mocks.notifyTeamFixEvent.mock.calls[0][3]).toBe('fix_pr_opened')
  })

  it('failed: attempt + job failed, team notified fix_failed', async () => {
    const { db, queries } = pollDb([attempt()])
    const summary = await runAgentStatusPoll(db, {
      now: NOW,
      adapterFor: () => fakeAdapter(async () => ({ status: 'failed', error: 'Cursor run ERROR' })),
    })
    expect(summary).toMatchObject({ failed: 1 })
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')[0].payload).toMatchObject({ status: 'failed' })
    expect(mocks.notifyTeamFixEvent.mock.calls[0][3]).toBe('fix_failed')
  })

  it('completed without a PR: job → completed_no_pr', async () => {
    const { db, queries } = pollDb([attempt()])
    const summary = await runAgentStatusPoll(db, { now: NOW, adapterFor: () => fakeAdapter(async () => ({ status: 'completed' })) })
    expect(summary).toMatchObject({ completedNoPr: 1 })
    expect(findQueries(queries, 'fix_dispatch_jobs', 'update')[0].payload).toMatchObject({ status: 'completed_no_pr' })
  })

  it('vendor error leaves the row for the next tick (errors counted, nothing written)', async () => {
    const { db, queries } = pollDb([attempt()])
    const summary = await runAgentStatusPoll(db, {
      now: NOW,
      adapterFor: () => fakeAdapter(async () => {
        throw new Error('Cursor API 503 unavailable')
      }),
    })
    expect(summary).toMatchObject({ scanned: 1, errors: 1, working: 0, failed: 0 })
    expect(findQueries(queries, 'fix_attempts', 'update')).toHaveLength(0)
  })

  it('gives up on attempts older than 24 h so the report can be re-dispatched', async () => {
    const stale = attempt({ id: 'fa-old', started_at: new Date(NOW.getTime() - 30 * 3_600_000).toISOString() })
    const { db, queries } = pollDb([], [stale])
    const summary = await runAgentStatusPoll(db, { now: NOW, adapterFor: () => fakeAdapter(async () => ({ status: 'working' })) })
    expect(summary).toMatchObject({ expired: 1, scanned: 0 })
    const closed = findQueries(queries, 'fix_attempts', 'update')[0]
    expect(closed.payload).toMatchObject({ status: 'failed', error: expect.stringContaining('24 h') })
  })
})
