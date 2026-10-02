/**
 * FILE: packages/server/src/__tests__/fix-timeline.test.ts
 * PURPOSE: Regression guard for the fix timeline on report 469f6962
 *          (2026-10-02): "Agent started" showed twice, the dispatch row read
 *          "status: pending" after the fix had completed, and a closed PR
 *          never appeared.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dispatchEventStatus,
  mergeStoredFixTimeline,
  synthesizeFixTimeline,
  type TimelineDispatchRow,
  type TimelineFixRow,
} from '../../supabase/functions/_shared/fix-timeline.ts'

const NOW = () => '2026-10-02T03:00:00.000Z'

const DISPATCH: TimelineDispatchRow = {
  status: 'completed',
  created_at: '2026-10-02T01:40:40Z',
  started_at: '2026-10-02T01:40:44Z',
  finished_at: '2026-10-02T01:41:03Z',
}

const FIX: TimelineFixRow = {
  status: 'completed',
  created_at: '2026-10-02T01:40:45Z',
  started_at: '2026-10-02T01:40:45Z',
  completed_at: '2026-10-02T01:41:02Z',
  branch: 'bugfix/MUSHI-469f6962-visual',
  commit_sha: 'abc1234def',
  pr_url: 'https://github.com/kensaurus/mushi-mushi/pull/424',
  pr_number: 424,
  pr_state: null,
  merged_at: null,
  files_changed: ['apps/docs/app/layout.tsx'],
  lines_changed: 175,
  llm_model: 'claude-sonnet',
  check_run_status: 'completed',
  check_run_conclusion: 'failure',
  check_run_updated_at: '2026-10-02T01:56:24Z',
  error: null,
}

describe('synthesizeFixTimeline', () => {
  it('emits exactly one start event, carrying the model', () => {
    const events = synthesizeFixTimeline(DISPATCH, FIX, NOW)
    const starts = events.filter((e) => e.kind === 'started')
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ label: 'Agent started', detail: 'claude-sonnet', status: 'ok' })
  })

  it('never leaves the dispatch event pending once a worker picked it up', () => {
    const dispatched = synthesizeFixTimeline(DISPATCH, FIX, NOW).find((e) => e.kind === 'dispatched')
    expect(dispatched?.status).toBe('ok')
    expect(dispatchEventStatus({ ...DISPATCH, started_at: null, finished_at: null, status: 'queued' }, null)).toBe(
      'pending',
    )
    expect(dispatchEventStatus({ ...DISPATCH, started_at: null, finished_at: null, status: 'failed' }, null)).toBe(
      'fail',
    )
  })

  it('falls back to the worker start when the attempt has no start time', () => {
    const events = synthesizeFixTimeline(DISPATCH, { ...FIX, started_at: null }, NOW)
    const starts = events.filter((e) => e.kind === 'started')
    expect(starts).toHaveLength(1)
    expect(starts[0].at).toBe(DISPATCH.started_at)
  })

  it('shows a closed-unmerged PR as a failed lifecycle event, and CI failure as fail', () => {
    const events = synthesizeFixTimeline(DISPATCH, { ...FIX, pr_state: 'closed' }, NOW)
    expect(events.find((e) => e.kind === 'pr_state_changed')).toMatchObject({
      label: 'PR closed without merge',
      status: 'fail',
    })
    expect(events.find((e) => e.kind === 'ci_resolved')).toMatchObject({ label: 'CI failure', status: 'fail' })
  })

  it('is chronological', () => {
    const at = synthesizeFixTimeline(DISPATCH, FIX, NOW).map((e) => Date.parse(e.at))
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })
})

describe('mergeStoredFixTimeline', () => {
  it('keeps stored rows, fills only the stages they lack, and never duplicates a kind', () => {
    const stored = [
      { kind: 'pr_state_changed' as const, at: '2026-10-02T02:10:00Z', label: 'PR closed without merge', status: 'fail' as const },
    ]
    const events = mergeStoredFixTimeline(DISPATCH, FIX, stored, NOW)
    const kinds = events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'pr_state_changed')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'started')).toHaveLength(1)
    // A late ci-sync "closed" row must not hide branch / commit / PR.
    expect(kinds).toEqual(expect.arrayContaining(['dispatched', 'branch', 'commit', 'pr_opened', 'ci_resolved']))
  })

  it('a stored start suppresses the synthesised one', () => {
    const stored = [{ kind: 'started' as const, at: '2026-10-02T01:40:46Z', label: 'Agent started', status: 'ok' as const }]
    const events = mergeStoredFixTimeline(DISPATCH, FIX, stored, NOW)
    expect(events.filter((e) => e.kind === 'started')).toHaveLength(1)
  })
})

describe('timeline route wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/query-fixes-repo.ts'), 'utf8')

  it('builds both streams through the shared module', () => {
    expect(src).toMatch(/mergeStoredFixTimeline\(/)
    expect(src).toMatch(/synthesizeFixTimeline\(/)
    expect(src).not.toMatch(/label: 'Worker started'/)
  })

  it('returns the real base branch instead of letting the graph guess main', () => {
    expect(src).toMatch(/base_branch: baseBranch/)
    expect(src).toMatch(/from\('project_repos'\)\.select\('default_branch'\)/)
  })
})
