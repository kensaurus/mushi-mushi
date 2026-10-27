import { describe, expect, it } from 'vitest'
import { readFixCi, rerunErrorText } from './ciInfra'
import type { CiInfraVerdict } from './ciTypes'
import { buildFixAttemptNodes, deriveStatuses } from '../components/fixes/fixAttemptFlow.data'
import { ciBadge, type FixAttempt } from '../components/fixes/types'

const verdict = (over: Partial<CiInfraVerdict>): CiInfraVerdict => ({
  kind: 'runner_lost',
  infra: true,
  job: 'build',
  runner: 'nuc-glot',
  queuedSeconds: null,
  detail: null,
  runId: 1,
  at: '2026-10-21T11:20:00Z',
  ...over,
})

describe('readFixCi', () => {
  it('a lost runner is a warning that the fix was not tested', () => {
    const r = readFixCi({ check_run_conclusion: 'cancelled', ci_infra: verdict({}) })
    expect(r).toMatchObject({ state: 'runner_lost', tone: 'warn', infra: true, canRerun: true })
    expect(r.detail).toBe("Tests didn't finish: the test machine (nuc-glot) stopped. Your fix was not tested.")
  })

  it('a job waiting for a machine says for how long and cannot be re-run yet', () => {
    const r = readFixCi({ check_run_status: 'queued', ci_infra: verdict({ kind: 'waiting_for_runner', runner: null, queuedSeconds: 720 }) })
    expect(r).toMatchObject({ state: 'waiting_for_runner', tone: 'warn', canRerun: false })
    expect(r.detail).toBe('Waiting for a test machine for 12 min. Your fix has not been tested yet.')
  })

  it('a queue that expired says no machine picked it up', () => {
    const r = readFixCi({ check_run_conclusion: 'cancelled', ci_infra: verdict({ kind: 'queue_expired', runner: null }) })
    expect(r).toMatchObject({ state: 'queue_expired', tone: 'warn' })
    expect(r.detail).toBe('No test machine picked this up, so GitHub cancelled it. Your fix was not tested.')
  })

  it('a plain cancel is neutral, not danger', () => {
    const r = readFixCi({ check_run_conclusion: 'cancelled' })
    expect(r).toMatchObject({ state: 'cancelled', tone: 'neutral', infra: false })
    expect(r.detail).toBe('Cancelled (a newer push or a person stopped it).')
  })

  it('a non-infra verdict falls through to the check-run reading', () => {
    expect(readFixCi({ check_run_conclusion: 'failure', ci_infra: verdict({ kind: 'code_failure', infra: false }) })).toMatchObject({ state: 'code_failure', tone: 'danger' })
  })

  it('code failures, passes and running are unchanged', () => {
    expect(readFixCi({ check_run_conclusion: 'failure' })).toMatchObject({ label: 'CI failed', tone: 'danger' })
    expect(readFixCi({ check_run_conclusion: 'success' })).toMatchObject({ label: 'CI passed', tone: 'ok' })
    expect(readFixCi({ check_run_status: 'in_progress' })).toMatchObject({ label: 'CI running…' })
    expect(readFixCi({})).toMatchObject({ state: 'unknown' })
  })
})

describe('rerunErrorText', () => {
  it('explains a run still in progress and a missing Actions: write permission', () => {
    expect(rerunErrorText('CI_RUNNING', 'x')).toMatch(/still running/)
    expect(rerunErrorText('GITHUB_ACTIONS_WRITE_MISSING', 'x')).toMatch(/Actions: write/)
    expect(rerunErrorText('GITHUB_ACTIONS_READ_MISSING', 'x')).toMatch(/Actions: read/)
    expect(rerunErrorText('RATE_LIMITED', 'x')).toMatch(/6 times an hour/)
    expect(rerunErrorText('NOTHING_TO_RERUN', 'x')).toMatch(/Nothing to re-run/)
    expect(rerunErrorText('NO_HEAD', "Mushi does not know the pull request's latest commit yet. Refresh CI first.")).toMatch(/Refresh CI first/)
    expect(rerunErrorText('OTHER', 'GitHub said no')).toBe('GitHub said no')
    expect(rerunErrorText(null, null)).toBe('Could not re-run the tests.')
  })
})

const FIX: FixAttempt = {
  id: 'f1',
  report_id: 'r1',
  agent: 'cursor_cloud',
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/glot.it/pull/140',
  pr_number: 140,
  started_at: '2026-10-21T11:00:00Z',
  check_run_conclusion: 'cancelled',
  review_passed: true,
}

describe('fix-loop surfaces with an infra verdict', () => {
  it('the Ship stage waits instead of failing, and says "not tested"', () => {
    const fix = { ...FIX, check_run_conclusion: 'failure', ci_infra: verdict({}) }
    expect(deriveStatuses(fix).act).toBe('pending')
    expect(buildFixAttemptNodes(fix).find((n) => n.data.stageKey === 'act')!.data.sublabel).toBe('not tested')
    expect(deriveStatuses({ ...fix, ci_infra: null }).act).toBe('failed')
  })

  it('the fix row badge is a warning', () => {
    const badge = ciBadge({ ...FIX, ci_infra: verdict({}) })!
    expect(badge.label).toBe('Not tested')
    expect(badge.className).toContain('warn')
  })
})
