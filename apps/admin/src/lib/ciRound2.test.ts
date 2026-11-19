/**
 * FILE: apps/admin/src/lib/ciRound2.test.ts
 * PURPOSE: The /ci round-2 fixes (2026-11-18): one machine status on every tab, one window for the
 *          week's outcome counts, queue filters that add up, jobs grouped by PR, the delay said once,
 *          a shared missing label said once, advice chips grouped by repo, stopped runs to re-run,
 *          and "not run" for jobs nobody picked up.
 */

import { describe, expect, it } from 'vitest'
import type { CiJob } from './ciTypes'
import { ciVerdict, ciWindowCounts } from './ciView'
import { machineByName, machinePresence, machinePresenceWord, machinesWithLabel, type MachineNow } from './ciStatus'
import { targetRowsByRepo, groupCiAdvice } from './ciAdvice'
import { passRateText } from './ciCompareView'
import { finishedFilterCounts, groupJobsByPr } from '../components/ci/CiQueueBoard'
import { commonDelay, sharedMissingLabels } from '../components/ci/CiStatusBoard'
import { costMachineStatus } from '../components/ci/CiCostSection'
import { labelServedBy } from '../components/ci/CiPlacementSection'
import { stoppedRunUrls } from '../components/ci/CiSections'

const machine = (over: Partial<MachineNow>): MachineNow => ({
  id: 'h1',
  name: 'overseas-ci',
  kind: 'self',
  detail: null,
  running: 0,
  apps: [],
  busyPct: null,
  memPct: null,
  stale: false,
  labels: ['kensaurus-local'],
  ...over,
})

const job = (over: Partial<CiJob>): CiJob =>
  ({
    id: 'j',
    repo: 'kensaurus/tsumagoi',
    workflowName: 'CI — PR Smoke Test',
    jobName: 'Browser gates',
    prNumber: 1292,
    status: 'completed',
    conclusion: 'success',
    htmlUrl: null,
    ...over,
  }) as CiJob

describe('one machine status for every tab', () => {
  it('reads the heartbeat: running, idle, offline', () => {
    expect(machinePresence(machine({ running: 3 }))).toBe('running')
    expect(machinePresenceWord(machine({ running: 3 }))).toBe('running 3')
    expect(machinePresence(machine({}))).toBe('idle')
    expect(machinePresence(machine({ stale: true, running: 2 }))).toBe('offline')
  })

  it('finds a machine by name and by label, self-hosted only', () => {
    const ms = [machine({ running: 3 }), machine({ id: 'gh', name: "GitHub's cloud", kind: 'github', labels: ['kensaurus-local'] })]
    expect(machineByName(ms, 'Overseas-CI')?.id).toBe('h1')
    expect(machinesWithLabel(ms, 'KENSAURUS-LOCAL').map((m) => m.id)).toEqual(['h1'])
  })

  it('Speed and cost says what Now says, not GitHub\'s "offline" for a running machine', () => {
    const live = [machine({ running: 3 })]
    expect(costMachineStatus('overseas-ci', false, live)).toEqual({ word: 'running 3', tone: 'ok' })
    // Not listed by GitHub is not offline: one-job runners are deregistered between jobs.
    expect(costMachineStatus('nuc12', false, live)).toEqual({ word: 'not listed by GitHub now', tone: 'muted' })
    expect(costMachineStatus('nuc12', true, live)).toBeNull()
  })

  it('Settings names the machine serving a label instead of "0 of 7 online"', () => {
    expect(labelServedBy('kensaurus-local', 0, 7, [machine({ running: 3 })])).toEqual({ text: 'overseas-ci running 3', ok: true })
    expect(labelServedBy('kensaurus-local', 0, 7, [machine({ stale: true })])).toEqual({ text: 'overseas-ci offline', ok: false })
    expect(labelServedBy('nuc', 1, 2, [machine({})])).toEqual({ text: 'GitHub lists 1 of 2 online', ok: true })
    expect(labelServedBy('nuc', 0, 7, [])).toEqual({ text: 'no machine with this label reports in; GitHub lists none of 7 online', ok: false })
  })
})

describe('one window for the week', () => {
  const hourly = [
    { at: '2026-11-17T00:00:00Z', jobs: 600, passed: 500, codeFailures: 60, infraFailures: 20 },
    { at: '2026-11-17T01:00:00Z', jobs: 400, passed: 300, codeFailures: 40, infraFailures: 14 },
  ]
  const stats = { jobs: 100, passed: 80, codeFailures: 7, infraFailures: 3, hourly, windowJobs: 1000 }

  it('takes every count from the whole window when the server counted it', () => {
    expect(ciWindowCounts(stats)).toEqual({ passed: 800, codeFailures: 100, infra: 34, other: 66, total: 1000, sampled: false })
  })

  it('so the headline and the bar say the same number', () => {
    const v = ciVerdict({ stats: { ...stats, passRate: 0.9, queueP50s: 1, queueP95s: 1, durationP50s: 1, durationP95s: 1, byRunner: [], byWorkflow: [], slowSteps: [] }, window: { days: 7 } } as never)
    expect(v.headline).toBe('100 jobs failed on the code in 7 days.')
    expect(v.detail).toContain('34 more in 7 days stopped')
  })

  it('falls back to the jobs read on an older server', () => {
    expect(ciWindowCounts({ jobs: 10, passed: 6, codeFailures: 2, infraFailures: 1 })).toMatchObject({ total: 10, passed: 6, codeFailures: 2, infra: 1, other: 1 })
  })
})

describe('the finished queue', () => {
  it('has a filter for every outcome, so the parts add up to All', () => {
    const jobs = [
      job({ id: 'a', ciKind: 'passed' }),
      job({ id: 'b', ciKind: 'code_failure' }),
      job({ id: 'c', ciKind: 'cancelled' }),
      job({ id: 'd', ciKind: 'skipped' }),
    ]
    const c = finishedFilterCounts(jobs)
    expect(c.code_failure + c.infra + c.cancelled + c.passed).toBe(c.all)
    expect(c.cancelled).toBe(2)
  })

  it('groups jobs by repo, workflow and PR, in first-appearance order', () => {
    const g = groupJobsByPr([job({ id: 'a' }), job({ id: 'b', prNumber: 7 }), job({ id: 'c' })])
    expect(g.map((x) => x.jobs.map((j) => j.id))).toEqual([['a', 'c'], ['b']])
    expect(g[0]).toMatchObject({ repo: 'kensaurus/tsumagoi', workflowName: 'CI — PR Smoke Test', prNumber: 1292 })
  })
})

describe('said once', () => {
  it('names the delay most apps share and keeps pills only on the rows that differ', () => {
    const nineWait = [...Array.from({ length: 9 }, () => ({ delay: 'waiting' as const })), { delay: null }]
    expect(commonDelay(nineWait)).toEqual({ delay: 'waiting', every: false })
    expect(commonDelay([{ delay: 'waiting' }, { delay: 'waiting' }, { delay: 'waiting' }])).toEqual({ delay: 'waiting', every: true })
    expect(commonDelay([{ delay: 'waiting' }, { delay: 'failing' }, { delay: null }])).toBeNull()
  })

  it('lifts a label several idle machines lack into one line', () => {
    const shared = sharedMissingLabels([
      { name: 'alienware-ci', missingLabels: ['kensaurus-local'] },
      { name: 'alienwarex16', missingLabels: ['kensaurus-local', 'gpu'] },
      { name: 'overseas-ci', missingLabels: [] },
    ])
    expect([...shared]).toEqual([['kensaurus-local', ['alienware-ci', 'alienwarex16']]])
  })

  it('groups advice chips by repo when a card spans repos', () => {
    const item = (repo: string, file: string) => ({
      id: `drafts_not_skipped:${repo}:.github/workflows/${file}`,
      severity: 'low' as const,
      title: 'Draft pull requests run the full CI',
      detail: 'd',
      evidence: `${repo}/.github/workflows/${file} runs on pull_request.`,
      fix: 'f',
      repo,
      workflow: `.github/workflows/${file}`,
    })
    const [g] = groupCiAdvice([item('kensaurus/mushi-mushi', 'ci.yml'), item('kensaurus/mushi-mushi', 'cla.yml'), item('kensaurus/glot.it', 'deploy.yml')])
    const rows = targetRowsByRepo(g.targets)
    expect(rows.map((r) => [r.repo, r.targets.map((t) => t.chip)])).toEqual([
      ['mushi-mushi', ['ci.yml', 'cla.yml']],
      ['glot.it', ['deploy.yml']],
    ])
    const [one] = groupCiAdvice([item('kensaurus/glot.it', 'deploy.yml')])
    expect(targetRowsByRepo(one.targets)).toEqual([{ repo: null, targets: [expect.objectContaining({ chip: 'deploy.yml' })] }])
  })
})

describe('re-run and pass rates', () => {
  it('lists each GitHub run behind the stopped jobs once', () => {
    expect(
      stoppedRunUrls([
        { htmlUrl: 'https://github.com/kensaurus/yen-yen/actions/runs/11/job/1' },
        { htmlUrl: 'https://github.com/kensaurus/yen-yen/actions/runs/11/job/2' },
        { htmlUrl: 'https://github.com/kensaurus/glot.it/actions/runs/12/job/3' },
        { htmlUrl: null },
      ]),
    ).toEqual(['https://github.com/kensaurus/yen-yen/actions/runs/11', 'https://github.com/kensaurus/glot.it/actions/runs/12'])
  })

  it('says "not run" for jobs nobody picked up, not 0%', () => {
    expect(passRateText({ runnerClass: 'unknown', prPassRate: 0 })).toBe('not run')
    expect(passRateText({ runnerClass: 'self_hosted', prPassRate: 0.94 })).toBe('94%')
  })
})
