/**
 * FILE: packages/server/src/__tests__/auto-decide-worker.test.ts
 * PURPOSE: The "Decide for me" tick (ADR 0055) acts on what it decided: an
 *          approved PR joins the merge queue (never one a person took out), a
 *          held PR is closed with a comment and its report goes back to the
 *          fix lanes, the third failed PR parks the report, and a dry run
 *          writes nothing.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

import { runAutoDecide, type AutoDecideDeps } from '../../supabase/functions/merge-queue/auto-decide.ts'
import { createFakeDb, eqValue, findQueries, type FakeQuery } from './__stubs__/fake-query-recorder.ts'

const NOW = new Date('2026-10-30T12:00:00Z')
const DAY_AGO = new Date(NOW.getTime() - 24 * 3600_000).toISOString()

interface Pr {
  id: string
  report: string
  n: number
  verdict: 'merge' | 'fix_first' | 'hold'
  fixesReport?: boolean
}

function scenario(prs: Pr[], opts: { queueRows?: Array<{ fix_attempt_id: string; state: string }>; earlierPrs?: Record<string, number> } = {}) {
  const attempts = prs.map((p) => ({
    id: p.id,
    project_id: 'p1',
    report_id: p.report,
    agent: 'mcp',
    branch: `b-${p.id}`,
    commit_sha: 'h1',
    pr_url: `https://github.com/acme/app/pull/${p.n}`,
    pr_number: p.n,
    repo_id: null,
    summary: null,
    created_at: '2026-10-20T00:00:00Z',
  }))
  const siblings = prs.flatMap((p) => [
    { id: p.id, report_id: p.report, pr_url: `u${p.n}`, pr_state: 'open', merged_at: null, created_at: '2026-10-20T00:00:00Z' },
    ...Array.from({ length: opts.earlierPrs?.[p.report] ?? 0 }, (_, i) => ({ id: `old-${p.report}-${i}`, report_id: p.report, pr_url: `old${i}`, pr_state: 'closed', merged_at: null, created_at: '2026-10-01T00:00:00Z' })),
  ])
  const reviews = prs.map((p) => ({
    id: `rv-${p.id}`,
    fix_attempt_id: p.id,
    status: 'completed',
    verdict: p.verdict,
    head_sha: 'h1',
    fixes_report: p.fixesReport ?? true,
    skip_reason: null,
    completed_at: DAY_AGO,
    comment_url: `https://github.com/acme/app/pull/${p.n}#issuecomment-1`,
    created_at: DAY_AGO,
  }))
  const { db, queries } = createFakeDb((q: FakeQuery) => {
    if (q.table === 'project_settings') return { data: [{ project_id: 'p1' }] }
    if (q.table === 'fix_attempts' && q.op === 'select') {
      if (q.columns?.startsWith('id, project_id, report_id, agent')) return { data: attempts }
      if (q.columns?.startsWith('id, report_id, pr_url')) return { data: siblings }
      return { data: null, count: 0 }
    }
    if (q.table === 'fix_merge_queue' && q.op === 'select') return { data: opts.queueRows ?? [] }
    if (q.table === 'fix_reviews') return { data: reviews }
    if (q.table === 'fix_review_followups') return { data: [] }
    if (q.table === 'reports' && q.op === 'select') return { data: prs.map((p) => ({ id: p.report, status: 'fixing' })) }
    return { data: null }
  })
  const closed: Array<{ n: number; comment: string }> = []
  const deps: AutoDecideDeps = {
    now: () => NOW,
    token: async () => 'tok',
    pull: async (_t, _r, n) => ({ number: n, draft: false, state: 'open', merged: false, headSha: 'h1', htmlUrl: null, headRef: null, baseRef: 'main' }),
    checks: async () => ({ pending: 0, failed: [], ran: ['test'] }),
    closePr: async (_t, _r, n, comment) => {
      closed.push({ n, comment })
    },
    requeueReview: vi.fn(async () => 'requeued' as const),
  }
  return { db, queries, deps, closed }
}

describe('runAutoDecide', () => {
  it('queues an approved PR without overwriting a row a person took out', async () => {
    const s = scenario([{ id: 'f1', report: 'r1', n: 11, verdict: 'merge' }])
    const out = await runAutoDecide(s.db, s.deps)
    expect(out.tally).toEqual({ queue: 1 })
    const up = findQueries(s.queries, 'fix_merge_queue', 'upsert')[0]
    expect(up.payload).toMatchObject({ fix_attempt_id: 'f1', state: 'queued', queued_by: null, repo: 'acme/app', pr_number: 11 })
    expect(up.options).toEqual({ onConflict: 'fix_attempt_id', ignoreDuplicates: true })
    expect(s.closed).toEqual([])
  })

  it('leaves a PR the queue already knows (queued, merged or removed by a person)', async () => {
    const s = scenario([{ id: 'f1', report: 'r1', n: 11, verdict: 'merge' }], { queueRows: [{ fix_attempt_id: 'f1', state: 'removed' }] })
    const out = await runAutoDecide(s.db, s.deps)
    expect(out.decisions).toEqual([])
    expect(findQueries(s.queries, 'fix_merge_queue', 'upsert')).toEqual([])
  })

  it('closes a held PR with the reason and hands its report back to the fix lanes', async () => {
    const s = scenario([{ id: 'f2', report: 'r2', n: 12, verdict: 'hold', fixesReport: false }])
    const out = await runAutoDecide(s.db, s.deps)
    expect(out.tally).toEqual({ close_redo: 1 })
    expect(s.closed[0].n).toBe(12)
    expect(s.closed[0].comment).toContain('does not fix the report')
    expect(s.closed[0].comment).toContain('#issuecomment-1')
    expect(findQueries(s.queries, 'fix_attempts', 'update').some((q) => (q.payload as { pr_state?: string }).pr_state === 'closed')).toBe(true)
    const back = findQueries(s.queries, 'reports', 'update')[0]
    expect(back.payload).toMatchObject({ status: 'classified' })
    expect(eqValue(back, 'status')).toBe('fixing')
  })

  it('parks the report on its third failed PR instead of trying again', async () => {
    const s = scenario([{ id: 'f3', report: 'r3', n: 13, verdict: 'hold' }], { earlierPrs: { r3: 2 } })
    const out = await runAutoDecide(s.db, s.deps)
    expect(out.tally).toEqual({ close_park: 1 })
    expect(findQueries(s.queries, 'reports', 'update')[0].payload).toMatchObject({ status: 'triaged' })
  })

  it('a dry run decides every PR and writes nothing', async () => {
    const s = scenario([
      { id: 'f1', report: 'r1', n: 11, verdict: 'merge' },
      { id: 'f2', report: 'r2', n: 12, verdict: 'hold' },
    ])
    const out = await runAutoDecide(s.db, s.deps, { projectId: 'p1', dryRun: true })
    expect(out.decisions.map((d) => d.decision)).toEqual(['queue', 'close_redo'])
    expect(s.queries.filter((q) => q.op !== 'select')).toEqual([])
    expect(s.closed).toEqual([])
  })

  it('closes the weaker of two open PRs for one report as superseded, without a redo', async () => {
    const s = scenario([
      { id: 'keep', report: 'r9', n: 21, verdict: 'merge' },
      { id: 'drop', report: 'r9', n: 22, verdict: 'hold' },
    ])
    const out = await runAutoDecide(s.db, s.deps)
    expect(out.decisions.find((d) => d.fixAttemptId === 'drop')?.decision).toBe('close_superseded')
    expect(out.decisions.find((d) => d.fixAttemptId === 'keep')?.decision).toBe('queue')
    expect(findQueries(s.queries, 'reports', 'update')).toEqual([])
  })
})
