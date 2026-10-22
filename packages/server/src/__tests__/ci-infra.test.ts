/**
 * FILE: ci-infra.test.ts
 * PURPOSE: The job classifier (Plan 022, ADR 0033) on real GitHub job shapes:
 *          the glot.it job cancelled when its self-hosted runner was
 *          OOM-killed (2026-10-21), a 24 h queue expiry, a superseded
 *          cancel, a failing test, and the run summary's precedence.
 */

import { describe, expect, it } from 'vitest'
import {
  CI_INFRA_KINDS,
  classifyCiJob,
  describeCiInfra,
  readFixCiInfra,
  runnerKindOf,
  summarizeCiJobs,
  waitThresholdSeconds,
  type CiJobInput,
  type CiJobKind,
  type CiJobVerdict,
} from '../../supabase/functions/_shared/ci-infra.ts'

const NOW = new Date('2026-10-21T09:00:00Z')

/** GET /repos/kensaurus/glot.it/actions/runs/…/jobs, the build job of PR #152 (trimmed). */
const GLOT_OOM_JOB: CiJobInput = {
  status: 'completed',
  conclusion: 'cancelled',
  created_at: '2026-10-21T06:41:12Z',
  started_at: '2026-10-21T06:41:15Z',
  completed_at: '2026-10-21T06:58:40Z',
  runner_id: 31,
  runner_name: 'kensaurus-local-glot-1',
  labels: ['self-hosted', 'linux', 'x64', 'glot'],
  steps: [
    { status: 'completed', started_at: '2026-10-21T06:41:16Z' },
    { status: 'completed', started_at: '2026-10-21T06:41:20Z' },
    { status: 'completed', started_at: '2026-10-21T06:43:02Z' },
  ],
}
const GLOT_OOM_ANNOTATION =
  'The self-hosted runner: kensaurus-local-glot-1 lost communication with the server. Verify the machine is running and has a healthy network connection. Anything in your workflow that terminates the runner process, starves it for CPU/Memory, or blocks its network access can cause this error.'

describe('classifyCiJob', () => {
  it('reads the OOM-killed glot.it job as runner_lost, infra, with the annotation', () => {
    const v = classifyCiJob(GLOT_OOM_JOB, { annotations: [GLOT_OOM_ANNOTATION], now: NOW })
    expect(v).toMatchObject({ kind: 'runner_lost', infra: true, runner: 'kensaurus-local-glot-1', queuedSeconds: 3 })
    expect(v.durationSeconds).toBe(1045)
    expect(v.detail).toMatch(/lost communication with the server/)
  })

  it('reads a failure after a shutdown signal as runner_lost', () => {
    const v = classifyCiJob(
      { ...GLOT_OOM_JOB, conclusion: 'failure' },
      { annotations: ['The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.'], now: NOW },
    )
    expect(v.kind).toBe('runner_lost')
  })

  it('reads a segfaulted step on a self-hosted runner as runner_lost (glot.it on the Alienware, 2026-10-22)', () => {
    const v = classifyCiJob(
      { ...GLOT_OOM_JOB, conclusion: 'failure', runner_name: 'alienware-glot-1' },
      { annotations: ['Node.js 20 is deprecated.', 'Process completed with exit code 139.'], now: NOW },
    )
    expect(v).toMatchObject({ kind: 'runner_lost', infra: true, runner: 'alienware-glot-1' })
    expect(v.detail).toMatch(/segmentation fault/)
  })

  it('reads every crash signal on a custom-labelled machine as runner_lost', () => {
    for (const code of [132, 133, 135, 137, 139]) {
      const v = classifyCiJob(
        { ...GLOT_OOM_JOB, conclusion: 'failure', labels: ['kensaurus-local'] },
        { annotations: [`Process completed with exit code ${code}.`], now: NOW },
      )
      expect(v.kind, String(code)).toBe('runner_lost')
    }
  })

  it('keeps a crash on a GitHub-hosted runner, and an ordinary exit code, as code_failure', () => {
    const hosted = classifyCiJob(
      { ...GLOT_OOM_JOB, conclusion: 'failure', runner_name: 'GitHub Actions 1000079285', labels: ['ubuntu-latest'] },
      { annotations: ['Process completed with exit code 139.'], now: NOW },
    )
    expect(hosted.kind).toBe('code_failure')
    for (const code of [1, 2, 13, 134, 1390]) {
      const v = classifyCiJob({ ...GLOT_OOM_JOB, conclusion: 'failure' }, { annotations: [`Process completed with exit code ${code}.`], now: NOW })
      expect(v.kind, String(code)).toBe('code_failure')
    }
  })

  it('reads steps that ran with no runner name left as runner_lost', () => {
    const v = classifyCiJob({ ...GLOT_OOM_JOB, runner_name: null, runner_id: null }, { annotations: [], now: NOW })
    expect(v).toMatchObject({ kind: 'runner_lost', infra: true, runner: null })
  })

  it('reads a job GitHub cancelled after 24 h with no runner as queue_expired', () => {
    const v = classifyCiJob(
      {
        status: 'completed',
        conclusion: 'cancelled',
        created_at: '2026-10-20T06:00:00Z',
        // GitHub fills started_at on jobs that never ran.
        started_at: '2026-10-20T06:00:00Z',
        completed_at: '2026-10-21T06:00:05Z',
        runner_id: 0,
        runner_name: null,
        labels: ['self-hosted', 'glot'],
        steps: [],
      },
      { now: NOW },
    )
    expect(v).toMatchObject({ kind: 'queue_expired', infra: true, durationSeconds: null })
    expect(v.queuedSeconds).toBe(24 * 3600 + 5)
    expect(v.detail).toMatch(/GitHub cancelled it/)
  })

  it('reads a queued job superseded by a newer push as plain cancelled', () => {
    const v = classifyCiJob(
      {
        status: 'completed',
        conclusion: 'cancelled',
        created_at: '2026-10-21T08:50:00Z',
        started_at: '2026-10-21T08:50:00Z',
        completed_at: '2026-10-21T08:52:30Z',
        runner_name: null,
        labels: ['self-hosted', 'glot'],
        steps: [],
      },
      { annotations: ["Canceling since a higher priority waiting request for 'ci-refs/pull/152' exists"], now: NOW },
    )
    expect(v).toMatchObject({ kind: 'cancelled', infra: false })
  })

  it('reads a running job cancelled by a person (no lost annotation) as cancelled', () => {
    const v = classifyCiJob(GLOT_OOM_JOB, { annotations: ['The operation was canceled.'], now: NOW })
    expect(v).toMatchObject({ kind: 'cancelled', infra: false })
  })

  it('reads a never-picked-up job cancelled after a long self-hosted wait as queue_expired', () => {
    const v = classifyCiJob(
      { status: 'completed', conclusion: 'cancelled', created_at: '2026-10-21T08:00:00Z', completed_at: '2026-10-21T08:40:00Z', labels: ['self-hosted'] },
      { now: NOW },
    )
    expect(v.kind).toBe('queue_expired')
  })

  it('reads a failing test on a live runner as code_failure', () => {
    const v = classifyCiJob(
      { ...GLOT_OOM_JOB, conclusion: 'failure', runner_name: 'GitHub Actions 12', labels: ['ubuntu-latest'] },
      { annotations: ['Process completed with exit code 1.'], now: NOW },
    )
    expect(v).toMatchObject({ kind: 'code_failure', infra: false })
    expect(classifyCiJob({ ...GLOT_OOM_JOB, conclusion: 'timed_out' }, { now: NOW }).kind).toBe('code_failure')
  })

  it('waits 10 min on self-hosted labels and 30 min on GitHub-hosted ones', () => {
    const queued = (createdMinAgo: number, labels: string[]): CiJobInput => ({
      status: 'queued',
      conclusion: null,
      created_at: new Date(NOW.getTime() - createdMinAgo * 60_000).toISOString(),
      labels,
    })
    expect(classifyCiJob(queued(9, ['self-hosted']), { now: NOW }).kind).toBe('queued')
    expect(classifyCiJob(queued(11, ['self-hosted']), { now: NOW })).toMatchObject({ kind: 'waiting_for_runner', infra: true })
    // A custom label without self-hosted is not a GitHub image either.
    expect(classifyCiJob(queued(11, ['glot-nuc']), { now: NOW }).kind).toBe('waiting_for_runner')
    expect(classifyCiJob(queued(20, ['ubuntu-latest']), { now: NOW }).kind).toBe('queued')
    expect(classifyCiJob(queued(31, ['ubuntu-latest']), { now: NOW }).kind).toBe('waiting_for_runner')
    expect(classifyCiJob({ ...queued(60, ['self-hosted']), status: 'waiting' }, { now: NOW }).kind).toBe('queued')
  })

  it('maps success, skipped and in_progress', () => {
    expect(classifyCiJob({ ...GLOT_OOM_JOB, conclusion: 'success' }, { now: NOW }).kind).toBe('passed')
    expect(classifyCiJob({ ...GLOT_OOM_JOB, conclusion: 'skipped' }, { now: NOW }).kind).toBe('skipped')
    expect(classifyCiJob({ ...GLOT_OOM_JOB, status: 'in_progress', conclusion: null }, { now: NOW }).kind).toBe('running')
  })
})

describe('runner kind and thresholds', () => {
  it('tells self-hosted, GitHub-hosted and unknown apart', () => {
    expect(runnerKindOf({ labels: ['self-hosted', 'linux'] })).toBe('self_hosted')
    expect(runnerKindOf({ labels: ['ubuntu-24.04'] })).toBe('github_hosted')
    expect(runnerKindOf({ labels: [], runner_name: 'GitHub Actions 3' })).toBe('github_hosted')
    expect(runnerKindOf({ labels: ['big-runner-16core'] })).toBe('unknown')
    expect(waitThresholdSeconds({ labels: [] })).toBe(30 * 60)
  })
})

describe('summarizeCiJobs', () => {
  const v = (kind: CiJobKind): CiJobVerdict => ({ kind, infra: CI_INFRA_KINDS.has(kind), runner: null, queuedSeconds: null, durationSeconds: null, detail: null })

  it('lets a code failure win over an infra verdict', () => {
    expect(summarizeCiJobs([v('runner_lost'), v('code_failure'), v('passed')])).toMatchObject({ kind: 'code_failure', infra: false, jobs: 3 })
  })
  it('lets an infra verdict win over a plain cancel', () => {
    const s = summarizeCiJobs([v('cancelled'), v('runner_lost'), v('passed')])
    expect(s).toMatchObject({ kind: 'runner_lost', infra: true })
    expect(s.worst?.kind).toBe('runner_lost')
    expect(s.counts).toEqual({ cancelled: 1, runner_lost: 1, passed: 1 })
  })
  it('says none for no jobs', () => {
    expect(summarizeCiJobs([])).toMatchObject({ kind: 'none', infra: false, worst: null })
  })
})

describe('stored ci_infra', () => {
  it('reads the jsonb defensively', () => {
    expect(readFixCiInfra(null)).toBeNull()
    expect(readFixCiInfra({ kind: 'bogus' })).toBeNull()
    expect(readFixCiInfra({ kind: 'cancelled', infra: true })?.infra).toBe(false)
    expect(readFixCiInfra({ kind: 'runner_lost', infra: true, runner: 'nuc', runId: 9, at: 'x' })).toMatchObject({ infra: true, runner: 'nuc', runId: 9 })
  })
  it('says it in plain words', () => {
    expect(describeCiInfra({ kind: 'runner_lost', runner: 'kensaurus-local-glot-1' })).toBe('runner lost on kensaurus-local-glot-1')
    expect(describeCiInfra({ kind: 'queue_expired', runner: null })).toBe('no runner picked the job up')
  })
})

describe('runner names of one-job runners', () => {
  it('strips the unix-seconds suffix and matches the heartbeat label', async () => {
    const { runnerBaseName, runnerNameMatches } = await import('../../supabase/functions/_shared/ci-infra.ts')
    expect(runnerBaseName('mushi-nuc-1761040000')).toBe('mushi-nuc')
    expect(runnerBaseName('kensaurus-local-glot-1')).toBe('kensaurus-local-glot-1')
    expect(runnerBaseName('build-2024')).toBe('build-2024')
    expect(runnerNameMatches('mushi-nuc', 'mushi-nuc-1761040000')).toBe(true)
    expect(runnerNameMatches('mushi-nuc', 'mushi-nuc')).toBe(true)
    expect(runnerNameMatches('mushi-nuc', 'mushi-nuc-2')).toBe(false)
    expect(runnerNameMatches('mushi', 'mushi-nuc-1761040000')).toBe(false)
  })

  it('folds a date stamp with a short suffix, and leaves ordinary names alone', async () => {
    const { runnerBaseName, runnerNameMatches } = await import('../../supabase/functions/_shared/ci-infra.ts')
    // <base>-<8..13 digits>
    expect(runnerBaseName('aw-tsumagoi-1022003316')).toBe('aw-tsumagoi')
    expect(runnerBaseName('box-20261022')).toBe('box')
    expect(runnerBaseName('box-1761040000123')).toBe('box')
    // <base>-<8..13 digits>-<1..6 letters or digits>
    expect(runnerBaseName('aw-tsumagoi-1022003316-163')).toBe('aw-tsumagoi')
    expect(runnerBaseName('aw-tsumagoi-1022011144-356')).toBe('aw-tsumagoi')
    expect(runnerBaseName('aw-tsumagoi-1022011144-a1B2c3')).toBe('aw-tsumagoi')
    expect(runnerNameMatches('aw-tsumagoi', 'aw-tsumagoi-1022003316-163')).toBe(true)
    // Not one-job names.
    for (const name of ['alienware-glot-1', 'kensaurus-local-tsumagoi-1', 'build-2024', 'runner-1234567', 'box-12345678901234', 'box-1022003316-1234567', 'box-1022003316-ab_c', '12345678', 'GitHub Actions 1000079285']) {
      expect(runnerBaseName(name)).toBe(name)
    }
  })
})

