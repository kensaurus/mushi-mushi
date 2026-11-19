import { describe, expect, it } from 'vitest'
import { ciOverviewFixture, FIXTURE_NOW } from '../components/ci/__fixtures__/ciOverview'
import type { CiJobDebug, CiOverview } from './ciTypes'
import { buildCiStatus, groupFailureCauses, groupFailures } from './ciStatus'
import { rankCiAlerts } from './ciAlerts'
import {
  buildCiAppGroups,
  ciAppCount,
  ciDebugErrorView,
  debugPanelReducer,
  initialPanelState,
  logStatusLine,
  oneJobPerRun,
  stepStatus,
} from './ciDebug'

const P2 = '22222222-2222-4222-8222-222222222222'
const MUSHI = 'kensaurus/mushi-mushi'

/** The fixture with mushi-mushi as its own app. */
function twoApps(over: (o: CiOverview) => void = () => {}): CiOverview {
  const o = ciOverviewFixture()
  o.repos = o.repos.map((r) => (r.repo === MUSHI ? { ...r, projectId: P2 } : r))
  o.jobs = o.jobs.map((j) => (j.repo === MUSHI ? { ...j, projectId: P2 } : j))
  over(o)
  return o
}

function groupsOf(o: CiOverview) {
  const status = buildCiStatus(o, FIXTURE_NOW)
  const { causes, singles } = groupFailureCauses(groupFailures(o, FIXTURE_NOW))
  return buildCiAppGroups({ overview: o, status, alerts: rankCiAlerts(o, status, FIXTURE_NOW), causes, singles })
}

const debug = (over: Partial<CiJobDebug> = {}): CiJobDebug => ({
  job: {
    id: 'j7',
    projectId: P2,
    repo: MUSHI,
    runId: 1000,
    runAttempt: 1,
    jobId: 7,
    jobName: 'test',
    workflowName: 'CI',
    prNumber: null,
    headBranch: 'main',
    status: 'completed',
    conclusion: 'failure',
    ciKind: 'code_failure',
    infra: false,
    infraDetail: null,
    htmlUrl: null,
    runUrl: 'https://github.com/kensaurus/mushi-mushi/actions/runs/1000',
    completedAt: null,
    durationSeconds: 60,
  },
  steps: [],
  failedStep: 'Run tests',
  log: { status: 'ok', excerpt: 'boom', linesDropped: 0 },
  annotations: [],
  explanation: null,
  actions: { rerun: true, cancel: false, explain: true, ciRepair: null },
  ...over,
})

describe('ciDebugErrorView', () => {
  it('puts the fix for a token without Actions write in the same spot, for that app', () => {
    const v = ciDebugErrorView('GITHUB_ACTIONS_WRITE_MISSING', 'raw', 'p 1')
    expect(v.text).toContain('Actions: Read and write')
    expect(v.fix).toEqual({ label: 'Fix GitHub access', to: '/integrations/config?project=p%201#platform-card-github' })
  })

  it('maps AI refusals to their settings and keeps the server line otherwise', () => {
    expect(ciDebugErrorView('NO_AI_KEY', null, 'p').fix?.to).toBe('/settings?tab=byok')
    expect(ciDebugErrorView('LLM_BUDGET_EXCEEDED', null, 'p').fix?.to).toBe('/settings#spend-limits')
    expect(ciDebugErrorView('WALLET_DENIED', null, 'p').fix?.to).toBe('/team?view=billing')
    expect(ciDebugErrorView('CI_RUNNING', 'Still running.', 'p')).toEqual({ text: 'Still running.', fix: null })
    expect(ciDebugErrorView(undefined, undefined, 'p').text).toMatch(/Try again/)
  })
})

describe('labels', () => {
  it('reads step conclusions as marks', () => {
    expect(['success', 'failure', 'timed_out', 'cancelled', 'in_progress', 'skipped', null].map(stepStatus)).toEqual(['passed', 'failed', 'failed', 'cancelled', 'running', 'idle', 'idle'])
  })

  it('says why there is no log, and when the GitHub fix applies', () => {
    expect(logStatusLine('ok')).toBeNull()
    expect(logStatusLine('running')?.github).toBe(false)
    expect(logStatusLine('not_bound')?.github).toBe(true)
    expect(logStatusLine('no_token')?.github).toBe(true)
    expect(logStatusLine('unavailable')?.text).toMatch(/expire/)
  })
})

describe('debugPanelReducer', () => {
  it('loads once per open and ignores a late answer for a job the user left', () => {
    let s = debugPanelReducer(initialPanelState(), { type: 'open', jobId: 'a' })
    expect(s).toMatchObject({ jobId: 'a', load: 'loading' })
    s = debugPanelReducer(s, { type: 'open', jobId: 'b' })
    s = debugPanelReducer(s, { type: 'loaded', jobId: 'a', data: debug() })
    expect(s).toMatchObject({ jobId: 'b', load: 'loading', data: null })
    s = debugPanelReducer(s, { type: 'loaded', jobId: 'b', data: debug() })
    expect(s.load).toBe('ready')
    // Opening the same job again keeps what is on screen.
    expect(debugPanelReducer(s, { type: 'open', jobId: 'b' })).toBe(s)
    expect(debugPanelReducer(s, { type: 'close' }).jobId).toBeNull()
  })

  it('retries a failed load on open', () => {
    let s = debugPanelReducer(initialPanelState('a'), { type: 'loadFailed', jobId: 'a', error: { text: 'x', fix: null } })
    expect(s.load).toBe('error')
    s = debugPanelReducer(s, { type: 'open', jobId: 'a' })
    expect(s.load).toBe('loading')
  })

  it('writes the explanation into the loaded job and keeps an AI refusal with its fix', () => {
    let s = debugPanelReducer(initialPanelState('a'), { type: 'loaded', jobId: 'a', data: debug() })
    s = debugPanelReducer(s, { type: 'explainStart' })
    expect(s.explain.state).toBe('busy')
    s = debugPanelReducer(s, { type: 'explainFailed', error: ciDebugErrorView('NO_AI_KEY', null, 'p') })
    expect(s.explain.error?.fix?.to).toBe('/settings?tab=byok')
    s = debugPanelReducer(s, { type: 'explained', explanation: { cause: 'c', nextStep: 'n', kind: 'code', source: 'ai', model: 'm', createdAt: 't' } })
    expect(s.explain).toEqual({ state: 'idle', error: null })
    expect(s.data?.explanation?.cause).toBe('c')
  })

  it('walks an action through confirm, busy and its outcome, each action on its own', () => {
    let s = debugPanelReducer(initialPanelState('a'), { type: 'actionConfirm', action: 'cancel' })
    expect(s.actions.cancel.state).toBe('confirm')
    expect(s.actions.rerun.state).toBe('idle')
    s = debugPanelReducer(s, { type: 'actionStart', action: 'cancel' })
    s = debugPanelReducer(s, { type: 'actionFailed', action: 'cancel', error: ciDebugErrorView('GITHUB_ACTIONS_WRITE_MISSING', null, 'p') })
    expect(s.actions.cancel).toMatchObject({ state: 'error', fix: { label: 'Fix GitHub access' } })
    s = debugPanelReducer(s, { type: 'actionDone', action: 'rerun', message: 'queued' })
    expect(s.actions.rerun).toEqual({ state: 'done', message: 'queued', fix: null })
  })
})

describe('buildCiAppGroups', () => {
  it('files each app\'s cards, live jobs and failures under it, the worst app first', () => {
    const g = groupsOf(twoApps())
    // mushi-mushi's test failed on the code (j7): that outranks glot.it's slow queue and stopped machine.
    expect(g.apps.map((a) => a.name)).toEqual(['mushi-mushi', 'glot.it'])
    const mushi = g.apps[0]!
    const glot = g.apps[1]!
    expect(mushi.singles.map((s) => s.failure.job.id)).toContain('j7')
    expect(mushi.counts.failed).toBe(1)
    expect(glot.alerts.map((a) => a.id)).toContain('queue-wait')
    // glot.it: the job running (j1) and the jobs waiting (j2, j3) are its own.
    expect(glot.running.map((r) => r.job.id)).toEqual(['j1'])
    expect(glot.waiting.map((w) => w.job.id).sort()).toEqual(['j2', 'j3'])
    expect(mushi.waiting.map((w) => w.job.id)).toEqual(['j4'])
    for (const a of g.apps) {
      for (const alert of a.alerts) expect(alert.projectId).toBe(a.id)
      expect(a.counts.waiting).toBe(a.waiting.length)
    }
    // The machine that stopped reporting is about no single app: it stays above the apps.
    expect(g.shared.alerts.some((a) => a.id === 'stale:h-aw')).toBe(true)
  })

  it('collapses a healthy app and shows its pass rate', () => {
    const g = groupsOf(
      twoApps((o) => {
        // mushi-mushi: nothing failed, nothing waiting, passes 95%.
        o.jobs = o.jobs.filter((j) => j.repo !== MUSHI || j.ciKind === 'passed')
      }),
    )
    const mushi = g.apps.find((a) => a.id === P2)!
    expect(mushi.healthy).toBe(true)
    expect(mushi.passRate).toBeCloseTo(0.95)
    expect(g.apps.at(-1)!.id).toBe(P2)
    expect(g.apps[0]!.healthy).toBe(false)
  })

  it('keeps a cause seen in two apps together, above them', () => {
    const o = twoApps((x) => {
      const fail = (id: string, repo: string, projectId: string, pr: number) => ({
        ...x.jobs[0]!,
        id,
        repo,
        projectId,
        prNumber: pr,
        runId: pr,
        jobName: 'freshness',
        status: 'completed',
        conclusion: 'failure',
        ciKind: 'code_failure' as const,
        failedStep: 'Check Mushi SDK freshness',
        createdAt: '2026-10-21T11:40:00Z',
        completedAt: '2026-10-21T11:45:00Z',
      })
      x.jobs = [...x.jobs, fail('f1', 'kensaurus/glot.it', x.repos[0]!.projectId, 501), fail('f2', MUSHI, P2, 502)]
    })
    const g = groupsOf(o)
    expect(g.shared.causes.map((c) => c.step)).toEqual(['Check Mushi SDK freshness'])
    expect(g.apps.flatMap((a) => a.causes)).toEqual([])
    expect(g.apps.flatMap((a) => a.singles).some((s) => s.failure.job.id === 'f1' || s.failure.job.id === 'f2')).toBe(false)
  })

  it('counts apps, and picks one job per run to re-run', () => {
    expect(ciAppCount(ciOverviewFixture())).toBe(1)
    expect(ciAppCount(twoApps())).toBe(2)
    expect(
      oneJobPerRun([
        { id: 'a', repo: 'r', runId: 1 },
        { id: 'b', repo: 'r', runId: 1 },
        { id: 'c', repo: 'r', runId: 2 },
        { id: 'd', repo: 's', runId: 1 },
      ]),
    ).toEqual(['a', 'c', 'd'])
  })
})
