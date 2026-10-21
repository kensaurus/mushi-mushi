/**
 * FILE: ci-fix-loop.test.ts
 * PURPOSE: The fix loop tells a stopped test machine from a broken fix
 *          (Plan 022, ADR 0033), on the glot.it OOM cancel of 2026-10-21:
 *            - fix-loop-status buckets it `ci_infra`, not `ci_failed`;
 *            - the Opus review prompt reads "did not finish", never failed;
 *            - the timeline shows "Tests did not run", pending, and corrects
 *              a stored "CI cancelled" event;
 *            - review follow-ups drop findings that only restate CI;
 *            - the head's verdict comes from its jobs, and a green head clears it.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import { CI_INFRA_STOPPED_LABEL, CI_INFRA_WAITING_LABEL, fixCiInfraLabel, fixFailureBucket, isFixCountedFailed } from '../../supabase/functions/_shared/fix-loop-status.ts'
import { ciPromptText, describeCi, normalizeReview } from '../../supabase/functions/_shared/fix-review.ts'
import { mergeStoredFixTimeline, synthesizeFixTimeline, type TimelineFixRow } from '../../supabase/functions/_shared/fix-timeline.ts'
import { restatesCiState, screenFindings } from '../../supabase/functions/_shared/review-followup.ts'
import { ciGithub, ciJobRow, fixCiInfraFromRows, refreshFixCiInfra, type GhJob } from '../../supabase/functions/_shared/ci-jobs.ts'
import { deriveReportFixTruth } from '../../supabase/functions/_shared/fix-report-truth.ts'

const NOW = new Date('2026-10-21T09:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const REPO = 'kensaurus/glot.it'
const LOST = 'The self-hosted runner: kensaurus-local-glot-1 lost communication with the server.'

const RUNNER_LOST = {
  kind: 'runner_lost',
  infra: true,
  job: 'build',
  runner: 'kensaurus-local-glot-1',
  queuedSeconds: 3,
  detail: LOST,
  runId: 9001,
  at: '2026-10-21T06:58:41Z',
}

const OOM_JOB: GhJob = {
  id: 501,
  run_id: 9001,
  name: 'build',
  status: 'completed',
  conclusion: 'cancelled',
  created_at: '2026-10-21T06:41:12Z',
  started_at: '2026-10-21T06:41:15Z',
  completed_at: '2026-10-21T06:58:40Z',
  runner_name: 'kensaurus-local-glot-1',
  labels: ['self-hosted'],
  check_run_url: 'https://api.github.com/repos/kensaurus/glot.it/check-runs/501',
}

const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  report_id: 'r1',
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/glot.it/pull/152',
  pr_state: 'open',
  check_run_conclusion: 'cancelled',
  created_at: '2026-10-21T06:30:00Z',
  ...over,
})

describe('fix-loop-status', () => {
  it('buckets an infra stop as ci_infra and a code failure as ci_failed', () => {
    expect(isFixCountedFailed(attempt({ ci_infra: RUNNER_LOST }))).toBe(true)
    expect(fixFailureBucket(attempt({ ci_infra: RUNNER_LOST }))).toBe('ci_infra')
    expect(fixFailureBucket(attempt({ ci_infra: { ...RUNNER_LOST, kind: 'code_failure', infra: false } }))).toBe('ci_failed')
    expect(fixFailureBucket(attempt())).toBe('ci_failed')
  })

  it('labels the stop and the wait in plain words', () => {
    expect(fixCiInfraLabel(attempt({ ci_infra: RUNNER_LOST }))).toBe(CI_INFRA_STOPPED_LABEL)
    expect(CI_INFRA_STOPPED_LABEL).toBe('The test machine stopped — your fix was not tested')
    expect(fixCiInfraLabel({ ci_infra: { ...RUNNER_LOST, kind: 'waiting_for_runner' } })).toBe(CI_INFRA_WAITING_LABEL)
    expect(fixCiInfraLabel({ ci_infra: null })).toBeNull()
  })

  it('carries the bucket into the report truth', () => {
    const truth = deriveReportFixTruth({ reportId: 'r1', report: { id: 'r1', status: 'fixing' }, attempts: [attempt({ ci_infra: RUNNER_LOST })] })
    expect(truth).toMatchObject({ state: 'failed', failureBucket: 'ci_infra' })
  })
})

describe('review gate', () => {
  it('never reads an infra stop as a CI failure', () => {
    const ci = describeCi('cancelled', 'completed', RUNNER_LOST)
    expect(ci).toEqual({ text: 'did not finish (runner lost on kensaurus-local-glot-1)', failed: false, infra: true })
    expect(ciPromptText(ci)).toMatch(/tests did not run because the test machine failed/i)
    // A plain cancel still reads failed.
    expect(describeCi('cancelled', 'completed', null)).toEqual({ text: 'failed (cancelled)', failed: true })
    expect(ciPromptText(describeCi('success', 'completed'))).toBe('passed')
  })

  it('keeps a clean review at merge when the runner died', () => {
    const ci = describeCi('cancelled', 'completed', RUNNER_LOST)
    const review = normalizeReview(
      { findings: [], removes_behavior: [], scope_creep: false, needs_human_decision: null, fixes_report: true, risk: 'low', summary: 'ok', verdict: 'merge' },
      { ciFailed: ci.failed, diffTruncated: false },
    )
    expect(review.verdict).toBe('merge')
  })
})

describe('timeline', () => {
  const fix: TimelineFixRow = {
    status: 'completed',
    created_at: '2026-10-21T06:30:00Z',
    started_at: '2026-10-21T06:30:05Z',
    completed_at: '2026-10-21T06:40:00Z',
    branch: 'MUSHI-r1-cursor-cloud',
    commit_sha: 'abc1234',
    pr_url: 'https://github.com/kensaurus/glot.it/pull/152',
    pr_number: 152,
    files_changed: ['a.ts'],
    lines_changed: 3,
    llm_model: null,
    check_run_status: 'completed',
    check_run_conclusion: 'cancelled',
    check_run_updated_at: '2026-10-21T06:59:00Z',
    ci_infra: RUNNER_LOST,
    error: null,
  }

  it('shows an infra stop as untested, not failed', () => {
    const ci = synthesizeFixTimeline(null, fix).find((e) => e.kind === 'ci_resolved')!
    expect(ci).toMatchObject({ label: 'Tests did not run — runner lost on kensaurus-local-glot-1', status: 'pending' })
    expect(synthesizeFixTimeline(null, { ...fix, ci_infra: null }).find((e) => e.kind === 'ci_resolved')?.status).toBe('fail')
  })

  it('corrects a stored "CI cancelled" event', () => {
    const events = mergeStoredFixTimeline(null, fix, [{ kind: 'ci_resolved', at: '2026-10-21T06:58:41Z', label: 'CI cancelled', status: 'fail' }])
    const ci = events.filter((e) => e.kind === 'ci_resolved')
    expect(ci).toHaveLength(1)
    expect(ci[0]).toMatchObject({ status: 'pending', label: expect.stringMatching(/^Tests did not run/) })
  })
})

describe('review follow-ups', () => {
  const pr = { files: [{ filename: 'src/a.ts' }], complete: true, patches: [] }
  const finding = (issue: string, file = '(general)') => ({ severity: 'major' as const, file, line: null, issue, suggested_fix: 'Re-run it.' })

  it('drops findings that only restate CI when the machine stopped', () => {
    const ciOnly = finding('CI is failing: the build job was cancelled.')
    const code = finding('The new guard returns early and skips saving the lesson.', 'src/a.ts')
    const out = screenFindings([ciOnly, code], pr, { ciInfra: true })
    expect(out.kept).toEqual([code])
    expect(out.dropped.ciInfra).toBe(1)
    // Without an infra verdict the CI finding is kept for the agent.
    expect(screenFindings([ciOnly], pr).kept).toHaveLength(1)
  })

  it('keeps a failing test tied to a changed file', () => {
    expect(restatesCiState({ issue: 'The unit test for saveLesson fails because the guard returns early.', file: 'src/a.ts' })).toBe(false)
    expect(restatesCiState({ issue: 'Checks did not run to completion.', file: 'src/a.ts' })).toBe(true)
  })
})

describe('head verdict', () => {
  it('summarizes rows, and a green head clears it', () => {
    const lost = ciJobRow({ projectId: P1, repo: REPO, job: OOM_JOB, annotations: [LOST], source: 'poll', now: NOW })!
    const passed = ciJobRow({ projectId: P1, repo: REPO, job: { ...OOM_JOB, id: 502, name: 'lint', conclusion: 'success' }, source: 'poll', now: NOW })!
    expect(fixCiInfraFromRows([lost, passed], NOW)).toMatchObject({ kind: 'runner_lost', infra: true, job: 'build', runner: 'kensaurus-local-glot-1', runId: 9001 })
    expect(fixCiInfraFromRows([passed], NOW)).toBeNull()
    expect(fixCiInfraFromRows([], NOW)).toBeNull()
  })

  it('reads the head in at most 9 calls and says when GitHub could not be read', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      if (url.includes('/actions/runs?')) return new Response(JSON.stringify({ workflow_runs: [{ id: 9001, head_sha: 'abc' }] }), { status: 200 })
      if (url.includes('/jobs')) return new Response(JSON.stringify({ jobs: [OOM_JOB] }), { status: 200 })
      if (url.includes('/annotations')) return new Response(JSON.stringify([{ message: LOST }]), { status: 200 })
      return new Response('{}', { status: 404 })
    }
    const db = makeFakeDb()
    const out = await refreshFixCiInfra(db as never, ciGithub('t', 9, fetchImpl), { projectId: P1, repo: REPO, headSha: 'abc', now: NOW })
    expect(out).toMatchObject({ read: true, verdict: { kind: 'runner_lost', infra: true } })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('head_sha=abc')

    const denied = await refreshFixCiInfra(db as never, ciGithub('t', 9, async () => new Response('{}', { status: 403 })), { projectId: P1, repo: REPO, headSha: 'abc', now: NOW })
    expect(denied.read).toBe(false)
  })
})
