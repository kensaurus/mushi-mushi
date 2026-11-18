/**
 * FILE: apps/admin/src/lib/ciStatus.ts
 * PURPOSE: The CI page's status board in plain words (2026-11-16; the owner: "I don't even
 *          know which machine is running the runner right now… I don't know what is the
 *          bottleneck or what is running well, and what I can estimate").
 *
 *   machineOfJob   — the machine a job runs on: a real machine's name, never a runner id
 *   buildCiStatus  — one headline sentence, what each machine is doing now, every running
 *                    job with "usually ~X, about Y left", and where each app's time goes
 *   groupFailures  — the last two hours' failures, one group per pull request, the failing
 *                    step named, summary checks ("gate") kept under the job that broke
 *
 * Pure: the page passes the overview it already has and `now`. Machine placement is the
 * runner map's (`hostOfRunner`), and "slower than usual" is "Needs attention"'s (`usualTime`),
 * so the board never disagrees with either.
 */

import type { CiJob, CiOverview } from './ciTypes'
import { hostOfRunner, jobElapsedSeconds, jobOutcome, repoShortName, runnerKey } from './ciView'
import { jobTypeIndex, recentFailed, runningLong, usualTime, waitingByRepo, type RecentFailure } from './ciAttention'

/** A wait past this for a machine is worth a sentence. */
const LONG_WAIT_S = 5 * 60
/** Below this pass rate, failing tests are the app's main delay. */
const LOW_PASS_RATE = 0.8
/** A typical run past this is the app's main delay when nothing else is. */
const SLOW_RUN_S = 10 * 60

interface JobMachine {
  id: string
  /** A person's word for the machine: its hostname, or "GitHub's cloud". */
  name: string
  kind: 'self' | 'github' | 'unregistered'
}

const GITHUB_MACHINE: JobMachine = { id: 'github', name: "GitHub's cloud", kind: 'github' }

/** @internal Exported for tests only. Where a job runs (or ran). Null before any machine took it. */
export function machineOfJob(overview: Pick<CiOverview, 'hosts' | 'runners'>, job: Pick<CiJob, 'runnerName' | 'runnerKind'>): JobMachine | null {
  if (job.runnerKind === 'github_hosted') return GITHUB_MACHINE
  if (!job.runnerName) return null
  const runner = overview.runners.find((r) => r.name === job.runnerName)
  const host = hostOfRunner(overview.hosts, runnerKey(job.runnerName), runner?.hostId ?? null)
  return host ? { id: host.hostId, name: host.hostname, kind: 'self' } : { id: 'unregistered', name: 'a machine that has not reported in', kind: 'unregistered' }
}

export interface MachineNow {
  id: string
  name: string
  kind: JobMachine['kind']
  /** "WSL · 32 CPUs" — enough to tell two machines apart. */
  detail: string | null
  running: number
  /** Running jobs per app, most first. */
  apps: Array<{ app: string; count: number }>
  /** load ÷ CPUs, 0–100; null when the machine does not report it. */
  busyPct: number | null
  memPct: number | null
  /** The machine stopped reporting. */
  stale: boolean
  /** Its runners' runs-on labels (generic ones like self-hosted / Linux / X64 left out). */
  labels?: string[]
  /** Labels waiting jobs need that this idle machine lacks: why it sits idle while jobs wait. */
  missingLabels?: string[]
  /** Highlight keys: its runners, so pointing at the tile lights their jobs. */
  runnerNames?: string[]
}

/** A job waiting for a machine, with the specific labels it needs. */
export interface WaitingNow {
  job: CiJob
  app: string
  waitS: number
  /** The job's non-generic runs-on labels ("kensaurus-local"); empty for GitHub's cloud. */
  needs: string[]
  /** True when an idle machine lacks a label this job needs (the mismatch to fix). */
  mismatch: boolean
}

export interface RunningNow {
  job: CiJob
  app: string
  machine: JobMachine | null
  elapsedS: number | null
  /** How long this job usually takes; null with fewer than three runs. */
  usualS: number | null
  /** Past "longer than usual" (the same limit as Needs attention). */
  slow: boolean
  /** usual − elapsed, when still under the usual time. */
  leftS: number | null
}

interface AppTime {
  repo: string
  app: string
  jobs7d: number
  /** 1 in 20 jobs waits this long or longer for a machine. */
  waitP95S: number | null
  /** Half the jobs finish within this. */
  runP50S: number | null
  passRate: number | null
  /** What slows this app's checks most, if anything. */
  delay: 'waiting' | 'failing' | 'slow' | null
}

export interface CiStatus {
  tone: 'ok' | 'warn' | 'bad'
  /** One or two sentences that answer "is CI OK right now, and what is slow". */
  headline: string
  /** Machines running something now, or that stopped reporting. */
  machines: MachineNow[]
  /** Every machine, busy first (the Machines tab). */
  allMachines: MachineNow[]
  /** Machines with nothing running, by name: one line, not a card each. */
  idle: string[]
  running: RunningNow[]
  waiting: number
  /** The longest current wait for a machine. */
  oldestWaitS: number | null
  /** Why the waiting jobs wait, when it can be read from the data (which machines take them). */
  waitWhy: string | null
  /** Every waiting job, oldest first, with the labels it needs. */
  waitingJobs: WaitingNow[]
  apps: AppTime[]
  /** The worst delay across apps this week, as a sentence; null when none stands out. */
  bottleneck: string | null
}

function minutes(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function appName(overview: Pick<CiOverview, 'repos'>, repo: string): string {
  return overview.repos.find((r) => r.repo === repo)?.projectName ?? repoShortName(repo)
}

function platformWord(p: string): string {
  return p === 'wsl2' ? 'WSL' : p === 'macos' ? 'Mac' : p === 'windows' ? 'Windows' : 'Linux'
}

/** GitHub's own machines: a job asking only for these waits on GitHub, not on yours. */
const GITHUB_LABEL = /^(ubuntu|windows|macos)(-|$)/i

const labelKey = (labels: string[]) => labels.map((l) => l.toLowerCase()).sort().join(',')

/** Labels every self-hosted runner has; they never tell machines apart. */
const GENERIC_LABEL = /^(self-hosted|linux|x64|arm64|arm|windows|macos|wsl2?)$/i

/** @internal Exported for tests. The labels that pick a machine, generic ones left out. */
export function specificLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.filter((l) => !GENERIC_LABEL.test(l) && !GITHUB_LABEL.test(l)))]
}

/** Each machine's specific labels: its runners' labels plus those of jobs that ran on it. */
function labelsByMachine(overview: CiOverview): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (id: string, labels: readonly string[]) => {
    const set = out.get(id) ?? new Set<string>()
    for (const l of specificLabels(labels)) set.add(l.toLowerCase())
    out.set(id, set)
  }
  for (const r of overview.runners) {
    const host = hostOfRunner(overview.hosts, runnerKey(r.name), r.hostId)
    if (host) add(host.hostId, r.labels)
  }
  for (const j of overview.jobs) {
    const m = machineOfJob(overview, j)
    if (m?.kind === 'self' && j.runnerName) add(m.id, j.labels)
  }
  return out
}

/** Runner names per machine (highlight keys). */
function runnersByMachine(overview: CiOverview): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (id: string, name: string) => out.set(id, (out.get(id) ?? new Set<string>()).add(name))
  for (const r of overview.runners) {
    const host = hostOfRunner(overview.hosts, runnerKey(r.name), r.hostId)
    if (host) add(host.hostId, r.name)
  }
  for (const j of overview.jobs) {
    const m = machineOfJob(overview, j)
    if (m && j.runnerName) add(m.id, j.runnerName)
  }
  return out
}

/**
 * Why the waiting jobs wait, read from this window's jobs: which machines have run a job
 * with the same runs-on labels. "3 jobs wait while 2 machines sit idle" was the first
 * question the page could not answer (owner, 2026-11-16): the idle ones are not set up
 * for those labels. No capacity figure exists, so it says "running N now", never "full".
 */
function whyWaiting(overview: CiOverview, machines: MachineNow[], idle: string[]): string | null {
  const groups = new Map<string, CiJob[]>()
  for (const j of overview.jobs) {
    if (jobOutcome(j) !== 'waiting') continue
    groups.set(labelKey(j.labels), [...(groups.get(labelKey(j.labels)) ?? []), j])
  }
  const biggest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (!biggest) return null
  const [key, jobs] = biggest
  const labels = jobs[0]!.labels
  if (labels.length === 0) return null
  const quoted = labels.map((l) => `“${l}”`).join(', ')
  if (labels.every((l) => GITHUB_LABEL.test(l))) return `They wait for GitHub's cloud (${quoted}), not for your machines.`
  // Machines that ran a job with these labels this window.
  const takers = new Set<string>()
  for (const j of overview.jobs) {
    if (labelKey(j.labels) !== key) continue
    const m = machineOfJob(overview, j)
    if (m?.kind === 'self') takers.add(m.id)
  }
  const them = jobs.length === 1 ? 'It needs' : 'They need'
  if (takers.size === 0) return `${them} a machine with the label ${quoted}, and none ran such a job this week: check that a runner is set up for it.`
  const takerMachines = machines.filter((m) => takers.has(m.id))
  const takerText = takerMachines.map((m) => `${m.name} (running ${m.running} now)`).join(' and ')
  const idleOthers = idle.filter((name) => !takerMachines.some((m) => m.name === name))
  const others = idleOthers.length
    ? ` ${idleOthers.join(' and ')} ${idleOthers.length === 1 ? 'is' : 'are'} idle but not set up for ${quoted}.`
    : ''
  return `${them} a ${quoted} machine; only ${takerText} ${takerMachines.length === 1 ? 'takes' : 'take'} those.${others}`
}

export function buildCiStatus(overview: CiOverview, now: number): CiStatus {
  const types = jobTypeIndex(overview.stats.byJob)
  // "Slower than usual" is exactly Needs attention's rule (runningLong), never a second copy.
  const longIds = new Set(runningLong(overview.jobs, overview.stats.byJob, now).map((r) => r.job.id))

  // Running jobs, with the machine and the usual time.
  const running: RunningNow[] = overview.jobs
    .filter((j) => jobOutcome(j) === 'running')
    .map((job) => {
      const elapsedS = jobElapsedSeconds(job, now)
      const u = usualTime(job, types)
      const slow = longIds.has(job.id)
      return {
        job,
        app: appName(overview, job.repo),
        machine: machineOfJob(overview, job),
        elapsedS,
        usualS: u?.typicalS ?? null,
        slow,
        leftS: u && elapsedS != null && elapsedS < u.typicalS ? u.typicalS - elapsedS : null,
      }
    })
    // Slow ones first, then the longest running.
    .sort((a, b) => Number(b.slow) - Number(a.slow) || (b.elapsedS ?? 0) - (a.elapsedS ?? 0))

  // Machines: every registered one, plus GitHub's cloud when it runs something now.
  const byMachine = new Map<string, RunningNow[]>()
  for (const r of running) {
    const id = r.machine?.id ?? 'unregistered'
    byMachine.set(id, [...(byMachine.get(id) ?? []), r])
  }
  const appsOf = (rs: RunningNow[]) => {
    const counts = new Map<string, number>()
    for (const r of rs) counts.set(r.app, (counts.get(r.app) ?? 0) + 1)
    return [...counts.entries()].map(([app, count]) => ({ app, count })).sort((a, b) => b.count - a.count || a.app.localeCompare(b.app))
  }
  const machineLabels = labelsByMachine(overview)
  const machineRunners = runnersByMachine(overview)
  const machines: MachineNow[] = overview.hosts.map((h) => {
    const rs = byMachine.get(h.hostId) ?? []
    const load = h.metrics.load1
    return {
      id: h.hostId,
      name: h.hostname,
      kind: 'self' as const,
      detail: [platformWord(h.platform), h.cpuCount ? `${h.cpuCount} CPUs` : null].filter(Boolean).join(' · ') || null,
      running: rs.length,
      apps: appsOf(rs),
      busyPct: load != null && h.cpuCount ? Math.min(100, Math.round((load / h.cpuCount) * 100)) : null,
      memPct: h.metrics.memUsedMb != null && h.memTotalMb ? Math.min(100, Math.round((h.metrics.memUsedMb / h.memTotalMb) * 100)) : null,
      stale: h.stale,
      labels: [...(machineLabels.get(h.hostId) ?? [])].sort(),
      missingLabels: [],
      runnerNames: [...(machineRunners.get(h.hostId) ?? [])],
    }
  })
  for (const [id, rs] of byMachine) {
    if (machines.some((m) => m.id === id)) continue
    const m = rs[0]!.machine
    machines.push({ id, name: m?.name ?? 'a machine that has not reported in', kind: m?.kind ?? 'unregistered', detail: null, running: rs.length, apps: appsOf(rs), busyPct: null, memPct: null, stale: false })
  }
  machines.sort((a, b) => b.running - a.running || a.name.localeCompare(b.name))

  // Waiting jobs and the label gap: an idle machine of yours that lacks a label a waiting job
  // needs is why "3 waiting" sits beside "2 idle" (owner, 2026-11-16 / 11-18).
  const waitingJobs: WaitingNow[] = overview.jobs
    .filter((j) => jobOutcome(j) === 'waiting')
    .map((job) => ({
      job,
      app: appName(overview, job.repo),
      waitS: Math.max(0, (now - Date.parse(job.createdAt)) / 1000),
      needs: specificLabels(job.labels),
      mismatch: false,
    }))
    .sort((a, b) => b.waitS - a.waitS)
  for (const m of machines) {
    if (m.kind !== 'self' || m.stale || m.running > 0) continue
    const has = new Set((m.labels ?? []).map((l) => l.toLowerCase()))
    const missing = new Set<string>()
    for (const w of waitingJobs) {
      const lacks = w.needs.filter((l) => !has.has(l.toLowerCase()))
      if (lacks.length === 0) continue
      lacks.forEach((l) => missing.add(l))
      w.mismatch = true
    }
    m.missingLabels = [...missing].sort()
  }
  const busy = machines.filter((m) => m.running > 0 || m.stale)
  const idle = machines.filter((m) => m.running === 0 && !m.stale).map((m) => m.name)

  // The queue.
  const queues = waitingByRepo(overview.jobs, now)
  const waiting = queues.reduce((n, q) => n + q.count, 0)
  const oldestWaitS = queues.length ? Math.max(...queues.map((q) => q.oldestS)) : null

  // Where each app's time goes this week.
  const apps: AppTime[] = overview.repos
    .filter((r) => r.jobs7d > 0)
    .map((r) => {
      const delay: AppTime['delay'] =
        r.queueP95s != null && r.queueP95s > LONG_WAIT_S ? 'waiting'
        : r.passRate != null && r.passRate < LOW_PASS_RATE ? 'failing'
        : r.durationP50s != null && r.durationP50s > SLOW_RUN_S ? 'slow'
        : null
      return { repo: r.repo, app: r.projectName || repoShortName(r.repo), jobs7d: r.jobs7d, waitP95S: r.queueP95s, runP50S: r.durationP50s, passRate: r.passRate, delay }
    })
    .sort((a, b) => Number(b.delay != null) - Number(a.delay != null) || b.jobs7d - a.jobs7d)
  // Two repos of one app (solo-boss-cloud and its docs) read as the same row twice: name the repo.
  const reposOf = new Map<string, Set<string>>()
  for (const a of apps) reposOf.set(a.app, (reposOf.get(a.app) ?? new Set()).add(a.repo))
  for (const a of apps) if ((reposOf.get(a.app)?.size ?? 0) > 1) a.app = `${a.app} (${repoShortName(a.repo)})`
  const worstWait = apps.filter((a) => a.delay === 'waiting').sort((a, b) => (b.waitP95S ?? 0) - (a.waitP95S ?? 0))[0]
  const worstFail = apps.filter((a) => a.delay === 'failing').sort((a, b) => (a.passRate ?? 1) - (b.passRate ?? 1))[0]
  const bottleneck = worstWait
    ? `${worstWait.app} waits longest for a machine: 1 job in 20 waits ${minutes(worstWait.waitP95S ?? 0)} or more.`
    : worstFail
      ? `${worstFail.app} loses the most time to failing checks: ${Math.round((1 - (worstFail.passRate ?? 0)) * 100)}% of its finished jobs fail.`
      : null

  // The headline.
  const stale = machines.filter((m) => m.stale && m.kind === 'self')
  const slowest = running.find((r) => r.slow)
  const where = busy.filter((m) => m.running > 0).map((m) => m.name)
  let tone: CiStatus['tone'] = 'ok'
  const parts: string[] = []
  if (stale.length) {
    tone = 'bad'
    parts.push(`${stale.map((m) => m.name).join(' and ')} stopped reporting: jobs that need ${stale.length === 1 ? 'it' : 'them'} will wait.`)
  }
  const waitWhy = waiting > 0 ? whyWaiting(overview, machines, idle) : null
  if (waiting > 0 && oldestWaitS != null && oldestWaitS > LONG_WAIT_S) {
    tone = tone === 'bad' ? 'bad' : 'warn'
    parts.push(`${waiting} job${waiting === 1 ? '' : 's'} waiting for a machine; the oldest for ${minutes(oldestWaitS)}.${waitWhy ? ` ${waitWhy}` : ''}`)
  }
  if (running.length === 0 && waiting === 0 && !stale.length) parts.push('Nothing is running or waiting: CI is idle.')
  else if (running.length > 0 && !parts.length) {
    parts.push(`CI is moving: ${running.length} job${running.length === 1 ? '' : 's'} running on ${where.join(' and ')}, ${waiting === 0 ? 'nothing waiting' : `${waiting} waiting`}.`)
  }
  if (slowest) {
    tone = tone === 'bad' ? 'bad' : 'warn'
    parts.push(`Slower than usual: ${slowest.job.jobName} (${slowest.app}), ${minutes(slowest.elapsedS ?? 0)} so far, usually ${minutes(slowest.usualS ?? 0)}.`)
  }
  return { tone, headline: parts.join(' '), machines: busy, allMachines: machines, idle, running, waiting, oldestWaitS, waitWhy, waitingJobs, apps, bottleneck }
}

export interface FailureGroup {
  key: string
  repo: string
  app: string
  prNumber: number | null
  branch: string | null
  at: number
  /** The jobs that broke, each with the step that failed. */
  broke: Array<{ failure: RecentFailure; step: string | null }>
  /** Summary checks ("gate") that failed only because another job did. */
  summaries: RecentFailure[]
  /** Every failure here is GitHub's "draft PRs run no CI": a skip, not a bug. */
  draftOnly: boolean
}

/** A step that only reports the other jobs' results ("Fail unless every needed job succeeded"). */
const SUMMARY_STEP = /\b(fail (unless|if)|every (needed|upstream) job|all (required|needed)|did not succeed)\b/i
const SUMMARY_NAME = /^(gate|ci gate|quality gate|all checks|required( checks?)?|ci status)$/i
const DRAFT_STEP = /\bdraft\b/i

/**
 * The last two hours' failures, one group per pull request (or branch), newest first.
 * A job is a summary check when its failing step only reports the others, or when it
 * has a summary name and another job of the same run failed too.
 */
export function groupFailures(overview: Pick<CiOverview, 'jobs' | 'repos'>, now: number): FailureGroup[] {
  const failures = recentFailed(overview.jobs, now)
  const failedRuns = new Map<string, number>()
  for (const f of failures) failedRuns.set(`${f.job.repo}|${f.job.runId}`, (failedRuns.get(`${f.job.repo}|${f.job.runId}`) ?? 0) + 1)
  const groups = new Map<string, FailureGroup & { drafts: RecentFailure[] }>()
  // Newest first, so a job that failed in two runs (a re-run) is listed once, as its latest
  // ("Rendered UI Audits failed at …" twice, "Also red: Quality Gate, Quality Gate").
  const ordered = [...failures].sort((a, b) => b.at - a.at)
  const seen = new Set<string>()
  for (const f of ordered) {
    const j = f.job
    const key = `${j.repo}|${j.prNumber != null ? `pr${j.prNumber}` : j.headBranch ?? j.runId}`
    const jobKey = `${key}|${j.workflowName ?? ''}|${j.jobName}`
    if (seen.has(jobKey)) continue
    seen.add(jobKey)
    let g = groups.get(key)
    if (!g) {
      g = { key, repo: j.repo, app: appName(overview, j.repo), prNumber: j.prNumber, branch: j.headBranch, at: f.at, broke: [], summaries: [], draftOnly: false, drafts: [] }
      groups.set(key, g)
    }
    g.at = Math.max(g.at, f.at)
    const step = j.failedStep ?? null
    // "Draft PRs run no CI" is a skip on purpose: never what broke while something else did.
    if (step && DRAFT_STEP.test(step)) {
      g.drafts.push(f)
      continue
    }
    const siblingFailed = (failedRuns.get(`${j.repo}|${j.runId}`) ?? 0) > 1
    const summary = f.kind === 'code' && ((step != null && SUMMARY_STEP.test(step)) || (SUMMARY_NAME.test(j.jobName.trim()) && siblingFailed))
    if (summary) g.summaries.push(f)
    else g.broke.push({ failure: f, step })
  }
  const out: FailureGroup[] = []
  for (const { drafts, ...g } of groups.values()) {
    if (g.broke.length === 0 && g.summaries.length === 0) {
      // Only draft skips: not a failure at all.
      out.push({ ...g, broke: drafts.map((failure) => ({ failure, step: failure.job.failedStep ?? null })), draftOnly: true })
      continue
    }
    g.summaries.push(...drafts)
    // A group of summaries only (the job that broke is older than the window): show them as what broke.
    if (g.broke.length === 0) {
      g.broke = g.summaries.map((failure) => ({ failure, step: failure.job.failedStep ?? null }))
      g.summaries = []
    }
    out.push(g)
  }
  return out.sort((a, b) => b.at - a.at)
}

/** One failing step seen across several pull requests: a pattern, not N paragraphs. */
export interface FailureCause {
  key: string
  /** The failing step ("Dependency audit"), else the job name. */
  step: string
  /** The job(s) it failed in. */
  jobs: string[]
  /** Each pull request (or branch) it broke, newest first. */
  hits: Array<{ group: FailureGroup; failure: RecentFailure }>
  apps: Array<{ repo: string; app: string }>
}

/**
 * Group the last two hours' failures by cause (2026-11-18; the owner: "you expect us to read a
 * bunch of text wall?"). The same failing step in two or more pull requests becomes ONE cause
 * ("Dependency audit · 5 PRs · 3 apps"); everything else stays a single compact row. Only code
 * failures with a named step group: "the machine stopped" is never one cause across PRs.
 */
export function groupFailureCauses(groups: readonly FailureGroup[]): { causes: FailureCause[]; singles: Array<{ group: FailureGroup; failure: RecentFailure; step: string | null }> } {
  const byStep = new Map<string, Array<{ group: FailureGroup; failure: RecentFailure; step: string | null }>>()
  const loose: Array<{ group: FailureGroup; failure: RecentFailure; step: string | null }> = []
  for (const g of groups) {
    if (g.draftOnly) continue
    for (const { failure, step } of g.broke) {
      if (failure.kind !== 'code' || !step) {
        loose.push({ group: g, failure, step })
        continue
      }
      const key = step.trim().toLowerCase()
      byStep.set(key, [...(byStep.get(key) ?? []), { group: g, failure, step }])
    }
  }
  const causes: FailureCause[] = []
  const singles = [...loose]
  for (const [key, hits] of byStep) {
    const prs = new Set(hits.map((h) => h.group.key))
    if (prs.size < 2) {
      singles.push(...hits)
      continue
    }
    const apps = new Map<string, string>()
    for (const h of hits) apps.set(h.group.repo, h.group.app)
    causes.push({
      key,
      step: hits[0]!.step!,
      jobs: [...new Set(hits.map((h) => h.failure.job.jobName))],
      hits: [...hits].sort((a, b) => b.failure.at - a.failure.at).map(({ group, failure }) => ({ group, failure })),
      apps: [...apps.entries()].map(([repo, app]) => ({ repo, app })),
    })
  }
  causes.sort((a, b) => b.hits.length - a.hits.length || b.apps.length - a.apps.length)
  singles.sort((a, b) => b.failure.at - a.failure.at)
  return { causes, singles }
}

/** "about 3 min left", "usually 9 min", "no usual time yet": the running job's estimate in words. */
export function estimateLine(r: Pick<RunningNow, 'elapsedS' | 'usualS' | 'slow' | 'leftS'>): string {
  if (r.usualS == null) return 'no usual time yet (fewer than 3 runs)'
  if (r.slow) return `slower than usual (usually ${minutes(r.usualS)})`
  if (r.leftS != null) return `usually ${minutes(r.usualS)} · about ${minutes(r.leftS)} left`
  return `usually ${minutes(r.usualS)} · should finish soon`
}

export { minutes as durationWords }
