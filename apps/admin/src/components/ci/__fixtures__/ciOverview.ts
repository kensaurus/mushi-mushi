/**
 * Typed CiOverview fixtures for the /ci tests, shaped like the glot.it NUC
 * day in Plan 022 (an OOM-killed runner, a queue behind it).
 */

import type { CiJob, CiOverview } from '../../../lib/ciTypes'

export const FIXTURE_NOW = Date.parse('2026-10-21T12:00:00Z')

const GLOT = 'kensaurus/glot.it'
const MUSHI = 'kensaurus/mushi-mushi'
const P1 = '11111111-1111-4111-8111-111111111111'

function job(over: Partial<CiJob> & Pick<CiJob, 'id' | 'repo' | 'jobName' | 'status' | 'ciKind' | 'createdAt'>): CiJob {
  return {
    projectId: P1,
    runId: 1000,
    jobId: Number(over.id.replace(/\D/g, '')) || 1,
    workflowName: 'CI',
    headBranch: 'mushi/fix',
    prNumber: null,
    conclusion: null,
    infra: false,
    infraDetail: null,
    runnerName: null,
    runnerKind: 'self_hosted',
    labels: ['self-hosted', 'Linux', 'X64'],
    queueSeconds: null,
    durationSeconds: null,
    startedAt: null,
    completedAt: null,
    htmlUrl: `https://github.com/${over.repo}/actions/runs/1000/job/${over.id}`,
    memPeakMb: null,
    ...over,
  }
}

export const FIXTURE_JOBS: CiJob[] = [
  job({ id: 'j1', repo: GLOT, jobName: 'build', status: 'in_progress', ciKind: 'running', prNumber: 141, runnerName: 'nuc-glot', createdAt: '2026-10-21T11:50:00Z', startedAt: '2026-10-21T11:52:00Z', queueSeconds: 120 }),
  job({ id: 'j2', repo: GLOT, jobName: 'e2e', status: 'queued', ciKind: 'waiting_for_runner', prNumber: 142, labels: ['self-hosted', 'Linux', 'X64', 'nuc'], createdAt: '2026-10-21T11:30:00Z' }),
  job({ id: 'j3', repo: GLOT, jobName: 'build', status: 'queued', ciKind: 'queued', prNumber: 143, labels: ['self-hosted', 'nuc'], createdAt: '2026-10-21T11:55:00Z' }),
  job({ id: 'j4', repo: MUSHI, jobName: 'lint', status: 'queued', ciKind: 'queued', runnerKind: 'github_hosted', labels: ['ubuntu-latest'], createdAt: '2026-10-21T11:58:00Z' }),
  job({ id: 'j5', repo: MUSHI, jobName: 'typecheck', status: 'completed', conclusion: 'success', ciKind: 'passed', runnerName: 'GitHub Actions 2', runnerKind: 'github_hosted', labels: ['ubuntu-latest'], createdAt: '2026-10-21T11:00:00Z', startedAt: '2026-10-21T11:01:00Z', completedAt: '2026-10-21T11:09:00Z', queueSeconds: 60, durationSeconds: 480 }),
  job({ id: 'j6', repo: GLOT, jobName: 'build', status: 'completed', conclusion: 'cancelled', ciKind: 'runner_lost', infra: true, infraDetail: 'The self-hosted runner: nuc-glot lost communication with the server.', prNumber: 140, runnerName: 'nuc-glot', createdAt: '2026-10-21T11:04:00Z', startedAt: '2026-10-21T11:05:00Z', completedAt: '2026-10-21T11:20:00Z', queueSeconds: 60, durationSeconds: 900, memPeakMb: 10100 }),
  job({ id: 'j7', repo: MUSHI, jobName: 'test', status: 'completed', conclusion: 'failure', ciKind: 'code_failure', runnerName: 'aw-1', createdAt: '2026-10-21T10:29:00Z', startedAt: '2026-10-21T10:30:00Z', completedAt: '2026-10-21T10:40:00Z', queueSeconds: 60, durationSeconds: 600 }),
  job({ id: 'j8', repo: GLOT, jobName: 'deploy', status: 'completed', conclusion: 'cancelled', ciKind: 'queue_expired', infra: true, infraDetail: 'No runner picked this job up in 24 h.', createdAt: '2026-10-20T11:00:00Z', completedAt: '2026-10-21T11:00:00Z', queueSeconds: 86400 }),
  job({ id: 'j9', repo: MUSHI, jobName: 'docs', status: 'completed', conclusion: 'cancelled', ciKind: 'cancelled', runnerName: 'aw-1', createdAt: '2026-10-21T09:00:00Z', startedAt: '2026-10-21T09:01:00Z', completedAt: '2026-10-21T09:05:00Z', queueSeconds: 60, durationSeconds: 240 }),
]

export function ciOverviewFixture(over: Partial<CiOverview> = {}): CiOverview {
  return {
    generatedAt: '2026-10-21T11:59:50Z',
    refreshedAt: '2026-10-21T11:59:40Z',
    window: { days: 7, from: '2026-10-14T12:00:00Z' },
    permissions: { jobs: 'ok', runners: 'ok' },
    hosts: [
      {
        hostId: 'h-nuc',
        hostname: 'nuc',
        platform: 'linux',
        cpuCount: 8,
        memTotalMb: 16000,
        lastHeartbeatAt: '2026-10-21T11:58:00Z',
        stale: false,
        mushiVersion: '1.40.0',
        metrics: { load1: 6.2, memUsedMb: 14500, swapUsedMb: 3900, swapTotalMb: 4096, diskFreeGb: 40 },
        runners: [{ name: 'nuc-glot', repo: GLOT, service: 'actions.runner.glot', active: true, restarts: 3, memCurrentMb: 9800, memMaxMb: 10240, oomKills: 1 }],
      },
      {
        hostId: 'h-aw',
        hostname: 'alienware-wsl',
        platform: 'wsl2',
        cpuCount: 16,
        memTotalMb: 32000,
        lastHeartbeatAt: '2026-10-21T09:00:00Z',
        stale: true,
        mushiVersion: null,
        metrics: {},
        runners: [{ name: 'aw-1', repo: MUSHI, service: null, active: false, restarts: 0, memCurrentMb: null, memMaxMb: null, oomKills: 0 }],
      },
    ],
    runners: [
      { projectId: P1, repo: GLOT, name: 'nuc-glot', status: 'online', busy: true, labels: ['self-hosted', 'Linux', 'X64', 'nuc'], kind: 'self_hosted', hostId: 'h-nuc', lastJobAt: '2026-10-21T11:52:00Z', jobs24h: 40, infraFailures7d: 2 },
      { projectId: P1, repo: MUSHI, name: 'aw-1', status: 'offline', busy: false, labels: ['self-hosted', 'Linux'], kind: 'self_hosted', hostId: 'h-aw', lastJobAt: '2026-10-21T10:40:00Z', jobs24h: 5, infraFailures7d: 0 },
      { projectId: P1, repo: MUSHI, name: 'GitHub Actions 2', status: 'unknown', busy: null, labels: ['ubuntu-latest'], kind: 'github_hosted', hostId: null, lastJobAt: '2026-10-21T11:09:00Z', jobs24h: 12, infraFailures7d: 0 },
      { projectId: P1, repo: GLOT, name: 'mystery', status: 'online', busy: false, labels: ['self-hosted'], kind: 'self_hosted', hostId: null, lastJobAt: null, jobs24h: 0, infraFailures7d: 0 },
    ],
    repos: [
      { projectId: P1, projectName: 'glot.it', repo: GLOT, queued: 2, running: 1, jobs7d: 300, passRate: 0.82, queueP95s: 1800, durationP50s: 420 },
      { projectId: P1, projectName: 'glot.it', repo: MUSHI, queued: 1, running: 0, jobs7d: 120, passRate: 0.95, queueP95s: 60, durationP50s: 300 },
    ],
    jobs: FIXTURE_JOBS,
    stats: {
      jobs: 420,
      passRate: 0.86,
      queueP50s: 90,
      queueP95s: 1500,
      durationP50s: 400,
      durationP95s: 1200,
      infraFailures: 6,
      codeFailures: 9,
      byRunner: [{ runner: 'nuc-glot', jobs: 300, busySeconds: 90000, infraFailures: 6, queueP95s: 1800 }],
      byWorkflow: [{ repo: GLOT, workflow: 'CI', jobs: 300, durationP50s: 420, durationP95s: 1300, failRate: 0.18 }],
      slowSteps: [{ repo: GLOT, job: 'build', step: 'pnpm install', p50s: 180, runs: 280 }],
    },
    advice: [
      {
        id: 'oom-kills',
        severity: 'high',
        title: 'nuc-glot ran out of memory',
        detail: 'The runner service hit its memory cap and was killed mid-job.',
        evidence: '1 OOM kill in 7 days; peak 10.1 GB of a 10 GB cap.',
        fix: 'sudo systemctl set-property actions.runner.glot MemoryMax=12G',
        runner: 'nuc-glot',
        hostId: 'h-nuc',
      },
      {
        id: 'cancel-in-progress',
        severity: 'low',
        title: 'Old pushes keep running',
        detail: 'A newer push does not cancel the run for an older one.',
        evidence: 'CI has no concurrency group.',
        fix: 'concurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true',
        repo: GLOT,
      },
    ],
    ...over,
  }
}

export function emptyCiOverview(): CiOverview {
  return ciOverviewFixture({
    hosts: [],
    runners: [],
    repos: [],
    jobs: [],
    advice: [],
    stats: { jobs: 0, passRate: null, queueP50s: null, queueP95s: null, durationP50s: null, durationP95s: null, infraFailures: 0, codeFailures: 0, byRunner: [], byWorkflow: [], slowSteps: [] },
  })
}
