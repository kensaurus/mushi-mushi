/**
 * FILE: apps/admin/src/lib/ciAlerts.ts
 * PURPOSE: "What's wrong", worst first (2026-11-17; the owner: "make it really easy to see what
 *          went wrong, what is bad… show important things first").
 *
 * Ranks the CI page's problems into short cards: a title that names the problem, one line of
 * detail, one big number, the keys that light up the same app / job / machine elsewhere on the
 * page, the GitHub log when there is one, and the section to jump to. Every card comes from data
 * the page already reads (buildCiStatus, stats.byJob, repos); nothing is estimated here.
 *
 * Critical: a machine stopped reporting, a job type that keeps failing, an app under 70%.
 * Serious: an app under 80%, a job running past its usual time, jobs waiting over 5 minutes,
 * jobs a test machine stopped, an app whose 1-in-20 wait is over 10 minutes.
 *
 * One cause, one card (2026-11-18; the owner: "you expect us to read a bunch of text wall?").
 * Four "Slow to start · 1 job in 20 waits N min" cards were the same sentence four times: every
 * app that waits long now shares ONE "Queue wait" card, drawn as a bar per app. Apps failing
 * often share one card per severity the same way. A different cause keeps its own card.
 */

import type { CiJob, CiOverview } from './ciTypes'
import type { CiStatus } from './ciStatus'
import { ciJobKey, ciJobKeys, ciRepoKey, ciRunnerKey, type CiKey } from './ciHighlight'
import { jobOutcome, repoShortName } from './ciView'

type CiAlertSeverity = 'critical' | 'serious'

export interface CiAlert {
  id: string
  severity: CiAlertSeverity
  /** Short words for the severity: "Keeps failing", "Running long". */
  label: string
  /** The app it is about, when it is one app. */
  app: string | null
  title: string
  detail: string
  metric: { value: string; unit: string }
  /** Hovering the card lights these up across the page; the first is the one a click pins. */
  keys: CiKey[]
  /** The newest relevant GitHub log. */
  href: string | null
  /** Where the evidence is: `#ci-…` on this view, or another view's href. */
  jump: string
  /** A small bar chart in the card: one bar per app (the grouped "Queue wait" / "Failing often"). */
  bars?: CiAlertBar[]
  /** A rate to draw as a bar beside the detail (0–1), e.g. a job type's fail rate. */
  rate?: number
  /**
   * Larger is worse, within a severity. Each kind has its own band so the order is deliberate:
   * machine down > keeps failing > app under 70%; running long > waiting > app under 80% >
   * machine stopped jobs > slow to start. The magnitude orders cards inside a band.
   */
  score: number
}

export interface CiAlertBar {
  key: CiKey
  label: string
  /** The bar's value on the card's own scale (seconds, or a 0–1 rate). */
  value: number
  /** The number printed beside the bar ("17 min", "43%"). */
  display: string
  severity: CiAlertSeverity
}

const LONG_WAIT_S = 5 * 60
const APP_WAIT_P95_S = 10 * 60
const CRITICAL_PASS = 0.7
const LOW_PASS = 0.8
const KEEPS_FAILING_RATE = 0.5
/** Cards shown; the page says how many more there are. */
export const ALERTS_SHOWN = 6

function mins(s: number): { value: string; unit: string } {
  if (s < 60) return { value: String(Math.round(s)), unit: 's' }
  if (s < 3600) return { value: String(Math.round(s / 60)), unit: 'min' }
  return { value: (s / 3600).toFixed(1), unit: 'h' }
}

function minWords(s: number): string {
  const m = mins(s)
  return `${m.value} ${m.unit}`
}

function appOf(overview: Pick<CiOverview, 'repos'>, repo: string): string {
  const r = overview.repos.find((x) => x.repo === repo)
  return r?.projectName || repoShortName(repo)
}

/** The newest job matching `pred` that has a log. */
function newestLog(jobs: CiJob[], pred: (j: CiJob) => boolean): string | null {
  let best: CiJob | null = null
  for (const j of jobs) {
    if (!j.htmlUrl || !pred(j)) continue
    if (!best || Date.parse(j.createdAt) > Date.parse(best.createdAt)) best = j
  }
  return best?.htmlUrl ?? null
}

export function rankCiAlerts(overview: CiOverview, status: CiStatus, now: number): CiAlert[] {
  const out: CiAlert[] = []

  // A machine that stopped reporting: everything that needs it waits.
  for (const host of overview.hosts.filter((h) => h.stale)) {
    const silentS = Math.max(0, (now - Date.parse(host.lastHeartbeatAt)) / 1000)
    out.push({
      id: `stale:${host.hostId}`,
      severity: 'critical',
      label: 'Machine down',
      app: null,
      title: `${host.hostname} stopped reporting`,
      detail: 'Jobs that need this machine will wait until it is back.',
      metric: mins(silentS),
      // Runner keys first: rows carry those, so pointing at the card lights that machine's lanes.
      keys: [...host.runners.map((r) => ciRunnerKey(r.name)), `machine:${host.hostname}`],
      href: null,
      jump: '?view=machines#ci-machines',
      score: 3 + Math.min(1, silentS / 86_400),
    })
  }

  // A job type that fails at least half of its runs, twice or more.
  const keepsFailing = (overview.stats.byJob ?? []).filter((t) => t.codeFailures >= 2 && (t.failRate ?? 0) >= KEEPS_FAILING_RATE)
  for (const t of keepsFailing) {
    out.push({
      id: `fails:${t.repo}|${t.workflow}|${t.job}`,
      severity: 'critical',
      label: 'Keeps failing',
      app: appOf(overview, t.repo),
      title: `${t.job} keeps failing`,
      detail: `${t.codeFailures} of its last ${t.runs} runs failed${t.workflow ? ` · ${t.workflow}` : ''}.`,
      metric: { value: String(Math.round((t.failRate ?? 0) * 100)), unit: '% fail' },
      keys: [ciJobKey(t.repo, t.job), ciRepoKey(t.repo)],
      href: newestLog(overview.jobs, (j) => j.repo === t.repo && j.jobName === t.job && jobOutcome(j) === 'code_failure'),
      jump: '#ci-job-times',
      rate: t.failRate ?? 0,
      score: 2 + Math.min(1, (t.codeFailures * (t.failRate ?? 0)) / 10),
    })
  }

  // Apps whose checks fail too often: one card per severity, a bar per app.
  const failing = overview.repos
    .filter((r) => r.passRate != null && r.passRate < LOW_PASS && r.jobs7d >= 5)
    .map((r) => ({ r, passRate: r.passRate!, severity: (r.passRate! < CRITICAL_PASS ? 'critical' : 'serious') as CiAlertSeverity }))
    .sort((x, y) => x.passRate - y.passRate)
  for (const severity of ['critical', 'serious'] as const) {
    const group = failing.filter((f) => f.severity === severity)
    if (group.length === 0) continue
    const worst = group[0]!
    const one = group.length === 1
    out.push({
      id: one ? `pass:${worst.r.repo}` : `pass:${severity}`,
      severity,
      label: 'Failing often',
      app: one ? appOf(overview, worst.r.repo) : null,
      title: one ? `Pass rate ${Math.round(worst.passRate * 100)}%` : `${group.length} apps fail ${severity === 'critical' ? 'over 30%' : 'over 20%'} of checks`,
      detail: one
        ? `${Math.round((1 - worst.passRate) * 100)}% of its finished jobs fail · ${worst.r.jobs7d} jobs in ${overview.window.days} days.`
        : `Share of finished jobs that fail, last ${overview.window.days} days.`,
      metric: { value: String(Math.round(worst.passRate * 100)), unit: '% pass' },
      keys: group.map((f) => ciRepoKey(f.r.repo)),
      href: one ? newestLog(overview.jobs, (j) => j.repo === worst.r.repo && jobOutcome(j) === 'code_failure') : null,
      jump: '#ci-week',
      bars: one
        ? undefined
        : group.map((f) => ({
            key: ciRepoKey(f.r.repo),
            label: appOf(overview, f.r.repo),
            value: 1 - f.passRate,
            display: `${Math.round((1 - f.passRate) * 100)}%`,
            severity: f.severity,
          })),
      rate: one ? 1 - worst.passRate : undefined,
      score: (severity === 'critical' ? 1 : 1.5) + (1 - worst.passRate) / 2,
    })
  }

  // Running past its usual time.
  for (const r of status.running.filter((x) => x.slow)) {
    const over = r.elapsedS != null && r.usualS != null ? r.elapsedS - r.usualS : 0
    out.push({
      id: `slow:${r.job.id}`,
      severity: 'serious',
      label: 'Running long',
      app: r.app,
      title: `${r.job.jobName} is running long`,
      detail: `${minWords(r.elapsedS ?? 0)} so far, usually ${minWords(r.usualS ?? 0)}${r.machine ? ` · ${r.machine.name}` : ''}.`,
      metric: { value: `+${mins(Math.max(0, over)).value}`, unit: mins(Math.max(0, over)).unit },
      keys: ciJobKeys(r.job),
      href: r.job.htmlUrl,
      jump: '#ci-attention',
      score: 3 + Math.min(1, over / 1800),
    })
  }

  // Jobs waiting for a machine.
  if (status.waiting > 0 && status.oldestWaitS != null && status.oldestWaitS > LONG_WAIT_S) {
    const waitingRepos = [...new Set(overview.jobs.filter((j) => jobOutcome(j) === 'waiting').map((j) => j.repo))]
    out.push({
      id: 'waiting',
      severity: 'serious',
      label: 'Waiting',
      app: waitingRepos.length === 1 ? appOf(overview, waitingRepos[0]!) : null,
      title: `${status.waiting} job${status.waiting === 1 ? '' : 's'} waiting for a machine`,
      detail: status.waitWhy ?? `The oldest has waited ${minWords(status.oldestWaitS)}.`,
      metric: mins(status.oldestWaitS),
      keys: waitingRepos.map(ciRepoKey),
      href: null,
      jump: '#ci-queue',
      score: 2.5 + Math.min(1, status.oldestWaitS / 3600) / 2,
    })
  }

  // Jobs a test machine stopped: not code failures, re-run them.
  if (overview.stats.infraFailures > 0) {
    const stopped = overview.jobs.filter((j) => jobOutcome(j) === 'infra')
    out.push({
      id: 'infra',
      severity: 'serious',
      label: 'Machine stopped',
      app: null,
      title: `${overview.stats.infraFailures} job${overview.stats.infraFailures === 1 ? '' : 's'} never finished`,
      detail: 'Not code failures: the test machine stopped. Re-run them.',
      metric: {
        value: String(overview.stats.infraFailures),
        unit: overview.stats.infraFailures === 1 ? 'job' : 'jobs',
      },
      // The runners that stopped, else the apps (a job that expired waiting has no runner).
      keys: [...new Set([...stopped.flatMap((j) => (j.runnerName ? [ciRunnerKey(j.runnerName)] : [])), ...stopped.map((j) => ciRepoKey(j.repo))])],
      href: null,
      jump: '?view=machines#ci-infra',
      score: 1 + Math.min(1, overview.stats.infraFailures / 20) / 2,
    })
  }

  // Apps that wait long for a machine over the week: ONE "Queue wait" card, a bar per app.
  const slowStart = overview.repos
    .filter((r) => r.queueP95s != null && r.queueP95s > APP_WAIT_P95_S)
    .sort((x, y) => (y.queueP95s ?? 0) - (x.queueP95s ?? 0))
  if (slowStart.length > 0) {
    const worstS = slowStart[0]!.queueP95s!
    out.push({
      id: 'queue-wait',
      severity: 'serious',
      label: 'Queue wait',
      app: slowStart.length === 1 ? appOf(overview, slowStart[0]!.repo) : null,
      title: slowStart.length === 1 ? `1 job in 20 waits ${minWords(worstS)}` : `${slowStart.length} apps wait for a machine`,
      detail: 'Too few machines take their jobs at busy times (1 job in 20 waits this long).',
      metric: mins(worstS),
      keys: slowStart.map((r) => ciRepoKey(r.repo)),
      href: null,
      jump: '#ci-timeline',
      bars: slowStart.map((r) => ({
        key: ciRepoKey(r.repo),
        label: appOf(overview, r.repo),
        value: r.queueP95s!,
        display: minWords(r.queueP95s!),
        // Half an hour or more for 1 job in 20 is as bad as a failing check.
        severity: r.queueP95s! >= 1800 ? 'critical' : 'serious',
      })),
      score: Math.min(1, worstS / 3600),
    })
  }

  const rank = (s: CiAlertSeverity) => (s === 'critical' ? 0 : 1)
  return out.sort((a, b) => rank(a.severity) - rank(b.severity) || b.score - a.score)
}
