/**
 * FILE: packages/server/supabase/functions/_shared/ci-advisor.ts
 * PURPOSE: "Why is my fix slow to land?" (Plan 022 Phase 4, ADR 0033.)
 *          Rule-based advice for the CI view, each with the evidence that
 *          triggered it and a concrete fix. Rules only fire on data Mushi
 *          has; a rule without its data is silent, never a guess.
 *
 *   queue_p95_self_hosted  self-hosted queue p95 > 10 min          (add a runner / stagger)
 *   infra_share            > 10 % of finished jobs stopped on the machine
 *   oom_kill               an OOM kill in the last 7 days            (high)
 *   memory_near_cap        a runner's memory peak ≥ 90 % of its cap
 *   swap_pressure          a host uses > 50 % of its swap
 *   host_stale             a host with runners has not reported in 10 min
 *   single_runner_busy     one runner serves a repo whose p95 queue > 15 min
 *   no_cancel_in_progress  a push / PR workflow keeps superseded runs going
 *   drafts_not_skipped     a PR workflow runs on draft PRs
 *   no_dependency_cache    installs dependencies without a cache
 *   slow_steps             the slowest steps (p50, ≥ 3 runs)
 *   rogue_runner_name      a runner named like the Shai-Hulud worm's backdoor (high)
 *   unknown_runner         a new self-hosted runner no heartbeat lists and no
 *                          `mushi-` label marks
 *
 * The Shai-Hulud 2.0 npm worm (Nov 2025) registered self-hosted runners
 * named SHA1HULUD on developers' repos as a backdoor
 * (https://www.sysdig.com/blog/how-threat-actors-are-using-self-hosted-github-actions-runners-as-backdoors).
 *
 * Pure apart from the workflow parser (recipe-drift.ts, npm:yaml).
 */

import { parse as parseYaml } from 'npm:yaml@2'
import { ciWorkflowDrift } from './recipe-drift.ts'
import type { CiOverviewAdvice } from './ci-overview-types.ts'
import { runnerNameMatches } from './ci-infra.ts'

export interface AdvisorJob {
  repo: string
  jobName: string
  status: string
  ciKind: string
  infra: boolean
  runnerName: string | null
  runnerKind: 'self_hosted' | 'github_hosted' | 'unknown'
  labels: string[]
  queueSeconds: number | null
  durationSeconds: number | null
  createdAt: string
  steps?: Array<{ name: string; conclusion: string | null; seconds: number | null }>
}

export interface AdvisorRunner {
  repo: string
  name: string
  kind: 'self_hosted' | 'github_hosted' | 'unknown'
  labels: string[]
  firstSeenAt: string | null
}

export interface AdvisorHost {
  hostId: string
  hostname: string
  lastHeartbeatAt: string
  metrics: { swapUsedMb?: number; swapTotalMb?: number }
  runners: Array<{ name: string; memCurrentMb: number | null; memMaxMb: number | null; oomKills: number | null }>
}

export interface AdvisorSample {
  hostId: string
  runnerName: string
  repo: string
  at: string
  memPeakMb: number | null
  memMaxMb: number | null
  oomKills: number | null
}

export interface AdvisorInput {
  now: Date
  jobs: AdvisorJob[]
  runners: AdvisorRunner[]
  hosts: AdvisorHost[]
  samples: AdvisorSample[]
  /** `.github/workflows/*.yml` texts per repo, from the GitHub connector snapshot. */
  workflows: Array<{ repo: string; path: string; text: string }>
  /** Earliest time Mushi saw any runner on each repo; unknown_runner needs history before the new one. */
  repoWatchedSince: Record<string, string>
}

const MIN = 60
const DAY_MS = 24 * 60 * 60_000
export const STALE_HEARTBEAT_MS = 10 * 60_000
const ROGUE_RUNNER_RE = /sha1hulud|shai-?hulud/i

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)))
  return v[rank - 1]
}

function mins(seconds: number): string {
  return seconds >= 90 * MIN ? `${Math.round((seconds / 3600) * 10) / 10} h` : `${Math.max(1, Math.round(seconds / MIN))} min`
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const i of items) {
    const k = key(i)
    const list = out.get(k)
    if (list) list.push(i)
    else out.set(k, [i])
  }
  return out
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function triggerNames(wf: Obj): string[] {
  const on = wf.on ?? wf[true as unknown as string]
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.filter((x): x is string => typeof x === 'string')
  if (isObj(on)) return Object.keys(on)
  return []
}

/** Workflow advice: superseded runs kept going, drafts tested, installs without a cache. */
function workflowAdvice(workflows: AdvisorInput['workflows']): CiOverviewAdvice[] {
  const out: CiOverviewAdvice[] = []
  for (const w of workflows) {
    let wf: unknown
    try {
      wf = parseYaml(w.text)
    } catch {
      continue
    }
    if (!isObj(wf) || !isObj(wf.jobs)) continue
    const names = triggerNames(wf)
    const onPr = names.includes('pull_request') || names.includes('pull_request_target')
    const onCode = onPr || names.includes('push')
    if (!onCode) continue

    const noGroup = ciWorkflowDrift({ [w.path]: w.text }).some((d) => d.ruleId === 'workflow_no_concurrency')
    const cancels = /cancel-in-progress\s*:\s*(?!false\b)\S/.test(w.text)
    if (noGroup || !cancels) {
      out.push({
        id: `no_cancel_in_progress:${w.repo}:${w.path}`,
        severity: 'medium',
        title: 'Old runs keep going after a new push',
        detail: `${w.path} runs on every push or pull request without cancelling the run it replaces, so superseded runs hold the runners while the newest commit waits.`,
        evidence: `${w.repo}/${w.path}: ${noGroup ? 'no concurrency group' : 'a concurrency group without cancel-in-progress'}.`,
        fix: "Add at the top of the workflow:\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        repo: w.repo,
      })
    }

    if (onPr && !/\bdraft\b/i.test(w.text)) {
      out.push({
        id: `drafts_not_skipped:${w.repo}:${w.path}`,
        severity: 'low',
        title: 'Draft pull requests run the full CI',
        detail: 'Coding agents open their pull requests as drafts and push to them several times. Each push runs this workflow before anyone can merge it.',
        evidence: `${w.repo}/${w.path} runs on pull_request and never checks the draft flag.`,
        fix: "Add `types: [opened, synchronize, reopened, ready_for_review]` under `pull_request:` and `if: github.event.pull_request.draft == false` on the expensive jobs.",
        repo: w.repo,
      })
    }

    const installs = /\b(?:pnpm install|npm ci|npm install|yarn install|yarn --frozen-lockfile|bun install)\b/.test(w.text)
    const cached = /\bcache\s*:|actions\/cache@|setup-bun@|cache-dependency-path/.test(w.text)
    if (installs && !cached) {
      out.push({
        id: `no_dependency_cache:${w.repo}:${w.path}`,
        severity: 'low',
        title: 'Dependencies are downloaded on every run',
        detail: 'The workflow installs packages without a cache, so every run downloads them again.',
        evidence: `${w.repo}/${w.path} installs dependencies and has no cache step.`,
        fix: 'On actions/setup-node add `cache: pnpm` (or npm / yarn), after pnpm/action-setup.',
        repo: w.repo,
      })
    }
  }
  return out
}

/** Every rule, high severity first. */
export function adviseCi(input: AdvisorInput): CiOverviewAdvice[] {
  const { now } = input
  const nowMs = now.getTime()
  const advice: CiOverviewAdvice[] = []
  const finished = input.jobs.filter((j) => j.status === 'completed' && j.ciKind !== 'skipped')
  const selfHosted = input.jobs.filter((j) => j.runnerKind === 'self_hosted' || j.labels.some((l) => l.toLowerCase() === 'self-hosted'))

  // ── Security: runners that should not be there ───────────────────────────
  const rogue = new Map<string, { repo: string; name: string }>()
  for (const r of input.runners) if (ROGUE_RUNNER_RE.test(r.name)) rogue.set(`${r.repo}|${r.name}`, { repo: r.repo, name: r.name })
  for (const j of input.jobs) if (j.runnerName && ROGUE_RUNNER_RE.test(j.runnerName)) rogue.set(`${j.repo}|${j.runnerName}`, { repo: j.repo, name: j.runnerName })
  for (const r of rogue.values()) {
    advice.push({
      id: `rogue_runner_name:${r.repo}:${r.name}`,
      severity: 'high',
      title: `A runner named "${r.name}" is registered on ${r.repo}`,
      detail: 'The Shai-Hulud npm worm registers self-hosted runners with this name on developers\' repositories as a backdoor: any workflow run can then execute code on the attacker\'s machine with your repository\'s secrets.',
      evidence: `Runner "${r.name}" on ${r.repo}.`,
      fix: 'Remove it in GitHub → Settings → Actions → Runners, rotate your GitHub and npm tokens.',
      repo: r.repo,
      runner: r.name,
    })
  }

  const heartbeatRunners = new Set(input.hosts.flatMap((h) => h.runners.map((r) => r.name)))
  for (const r of input.runners) {
    if (r.kind !== 'self_hosted' || !r.firstSeenAt || rogue.has(`${r.repo}|${r.name}`)) continue
    const first = Date.parse(r.firstSeenAt)
    if (!Number.isFinite(first) || nowMs - first > 7 * DAY_MS) continue
    if ([...heartbeatRunners].some((n) => runnerNameMatches(n, r.name))) continue
    if (r.labels.some((l) => l.toLowerCase().startsWith('mushi-'))) continue
    // Only "new" when Mushi watched the repo for a day before it appeared:
    // on the first collection every runner is first seen at once.
    const watched = Date.parse(input.repoWatchedSince[r.repo] ?? '')
    if (!Number.isFinite(watched) || first - watched < DAY_MS) continue
    const firstJob = input.jobs
      .filter((j) => j.repo === r.repo && j.runnerName === r.name)
      .map((j) => j.createdAt)
      .sort()[0]
    advice.push({
      id: `unknown_runner:${r.repo}:${r.name}`,
      severity: 'medium',
      title: `A new self-hosted runner "${r.name}" appeared on ${r.repo}`,
      detail: 'Mushi first saw this runner in the last 7 days. No host heartbeat lists it and it has no mushi- label, so Mushi cannot say whose machine it is.',
      evidence: `First seen ${r.firstSeenAt}${firstJob ? `, first job ${firstJob}` : ''} in ${r.repo}.`,
      fix: 'If you did not add this machine, remove it.',
      repo: r.repo,
      runner: r.name,
    })
  }

  // ── Memory on the hosts ──────────────────────────────────────────────────
  const weekAgo = nowMs - 7 * DAY_MS
  const ooms = new Map<string, { runner: string; hostId: string; count: number; repo: string | null }>()
  for (const s of input.samples) {
    if ((s.oomKills ?? 0) <= 0 || Date.parse(s.at) < weekAgo) continue
    const k = `${s.hostId}|${s.runnerName}`
    const cur = ooms.get(k) ?? { runner: s.runnerName, hostId: s.hostId, count: 0, repo: s.repo }
    cur.count += s.oomKills ?? 0
    ooms.set(k, cur)
  }
  for (const h of input.hosts) {
    if (Date.parse(h.lastHeartbeatAt) < weekAgo) continue
    for (const r of h.runners) {
      if ((r.oomKills ?? 0) > 0 && !ooms.has(`${h.hostId}|${r.name}`)) ooms.set(`${h.hostId}|${r.name}`, { runner: r.name, hostId: h.hostId, count: r.oomKills ?? 0, repo: null })
    }
  }
  const hostName = new Map(input.hosts.map((h) => [h.hostId, h.hostname]))
  for (const o of ooms.values()) {
    advice.push({
      id: `oom_kill:${o.hostId}:${o.runner}`,
      severity: 'high',
      title: `${o.runner} ran out of memory`,
      detail: 'The kernel killed a process on this runner for lack of memory. GitHub then cancels the job, and the fix it was testing is left untested.',
      evidence: `${o.count} OOM kill${o.count === 1 ? '' : 's'} on ${o.runner}${hostName.get(o.hostId) ? ` (${hostName.get(o.hostId)})` : ''} in the last 7 days.`,
      fix: 'Raise the runner service\'s MemoryMax, run one job at a time on this machine, or cap the build (e.g. NODE_OPTIONS=--max-old-space-size=3072, fewer parallel workers).',
      runner: o.runner,
      hostId: o.hostId,
      repo: o.repo,
    })
  }

  const nearCap = new Map<string, { runner: string; hostId: string; peak: number; cap: number }>()
  for (const s of input.samples) {
    if (Date.parse(s.at) < weekAgo || !s.memPeakMb || !s.memMaxMb) continue
    if (s.memPeakMb < 0.9 * s.memMaxMb) continue
    const k = `${s.hostId}|${s.runnerName}`
    const cur = nearCap.get(k)
    if (!cur || s.memPeakMb / s.memMaxMb > cur.peak / cur.cap) nearCap.set(k, { runner: s.runnerName, hostId: s.hostId, peak: s.memPeakMb, cap: s.memMaxMb })
  }
  for (const h of input.hosts) {
    for (const r of h.runners) {
      if (!r.memCurrentMb || !r.memMaxMb || r.memCurrentMb < 0.9 * r.memMaxMb) continue
      const k = `${h.hostId}|${r.name}`
      if (!nearCap.has(k)) nearCap.set(k, { runner: r.name, hostId: h.hostId, peak: r.memCurrentMb, cap: r.memMaxMb })
    }
  }
  for (const n of nearCap.values()) {
    if (ooms.has(`${n.hostId}|${n.runner}`)) continue
    advice.push({
      id: `memory_near_cap:${n.hostId}:${n.runner}`,
      severity: 'medium',
      title: `${n.runner} is close to its memory limit`,
      detail: 'A job on this runner used at least 90% of the memory the runner may use. One bigger build and the job is killed.',
      evidence: `Peak ${n.peak} MB of ${n.cap} MB (${pct(n.peak / n.cap)}) on ${n.runner}.`,
      fix: 'Raise the runner service\'s MemoryMax or lower the build\'s parallelism.',
      runner: n.runner,
      hostId: n.hostId,
    })
  }

  for (const h of input.hosts) {
    const used = h.metrics.swapUsedMb
    const total = h.metrics.swapTotalMb
    if (typeof used === 'number' && typeof total === 'number' && total > 0 && used / total > 0.5) {
      advice.push({
        id: `swap_pressure:${h.hostId}`,
        severity: 'medium',
        title: `${h.hostname} is swapping`,
        detail: 'More than half of the swap is in use, so builds on this machine slow down and are close to being killed.',
        evidence: `${used} MB of ${total} MB swap used (${pct(used / total)}).`,
        fix: 'Run fewer runners on this machine at once, or add memory.',
        hostId: h.hostId,
      })
    }
    const age = nowMs - Date.parse(h.lastHeartbeatAt)
    if (h.runners.length > 0 && age > STALE_HEARTBEAT_MS) {
      advice.push({
        id: `host_stale:${h.hostId}`,
        severity: 'medium',
        title: `${h.hostname} stopped reporting`,
        detail: 'This machine runs CI jobs but has not sent a heartbeat for over 10 minutes. It may be off, asleep or out of memory.',
        evidence: `Last heartbeat ${h.lastHeartbeatAt} (${mins(Math.round(age / 1000))} ago), ${h.runners.length} runner${h.runners.length === 1 ? '' : 's'} listed.`,
        fix: 'Check the machine is on and `mushi runner heartbeat` runs (systemd timer or cron every 2 minutes).',
        hostId: h.hostId,
      })
    }
  }

  // ── Queues ───────────────────────────────────────────────────────────────
  const shQueues = selfHosted.map((j) => j.queueSeconds).filter((q): q is number => typeof q === 'number')
  const shP95 = percentile(shQueues, 95)
  if (shQueues.length >= 5 && shP95 != null && shP95 > 10 * MIN) {
    advice.push({
      id: 'queue_p95_self_hosted',
      severity: shP95 > 30 * MIN ? 'high' : 'medium',
      title: 'Jobs wait a long time for your own runners',
      detail: 'One in twenty jobs on your self-hosted runners waits longer than this before it starts, so fixes sit untested.',
      evidence: `Queue p95 ${mins(shP95)} over ${shQueues.length} self-hosted jobs.`,
      fix: 'Add a runner (another service on the same machine if it has memory to spare), or stagger scheduled workflows so they do not start together.',
    })
  }

  const infraJobs = finished.filter((j) => j.infra)
  if (finished.length >= 5 && infraJobs.length / finished.length > 0.1) {
    const byRunner = [...groupBy(infraJobs, (j) => j.runnerName ?? 'no runner').entries()].sort((a, b) => b[1].length - a[1].length)
    advice.push({
      id: 'infra_share',
      severity: 'high',
      title: 'Many jobs stop because of the machine, not the code',
      detail: 'These jobs never finished testing: the runner died or no runner picked them up. Every one leaves a fix untested.',
      evidence: `${infraJobs.length} of ${finished.length} finished jobs (${pct(infraJobs.length / finished.length)}); most on ${byRunner[0][0]} (${byRunner[0][1].length}).`,
      fix: 'Look at the memory advice for that runner; re-run the affected jobs from the fix.',
      runner: byRunner[0][0] === 'no runner' ? null : byRunner[0][0],
    })
  }

  for (const [repo, jobs] of groupBy(selfHosted, (j) => j.repo)) {
    const names = new Set(jobs.map((j) => j.runnerName).filter(Boolean))
    const q = jobs.map((j) => j.queueSeconds).filter((x): x is number => typeof x === 'number')
    const p95 = percentile(q, 95)
    if (names.size === 1 && q.length >= 5 && p95 != null && p95 > 15 * MIN) {
      const runner = [...names][0] as string
      advice.push({
        id: `single_runner_busy:${repo}`,
        severity: 'medium',
        title: `${repo} has one runner and a long queue`,
        detail: 'Every job of this repository waits for the same machine.',
        evidence: `${q.length} jobs on ${runner}, queue p95 ${mins(p95)}.`,
        fix: `Register a second runner for ${repo} (\`mushi runner add --repo ${repo}\`), or move short jobs to GitHub-hosted runners.`,
        repo,
        runner,
      })
    }
  }

  advice.push(...workflowAdvice(input.workflows))

  const slow = slowSteps(input.jobs)
  if (slow.length > 0 && slow[0].p50s >= MIN) {
    advice.push({
      id: 'slow_steps',
      severity: 'low',
      title: 'Where your CI spends its time',
      detail: 'The slowest steps by median time over the window. Caching or splitting these shortens every run.',
      evidence: slow.map((s) => `${s.repo} · ${s.job} · ${s.step}: ${mins(s.p50s)} (${s.runs} runs)`).join('; '),
      fix: 'Cache what the slowest step downloads or builds, or run it only when its inputs change (paths filters).',
      repo: slow[0].repo,
    })
  }

  const rank = { high: 0, medium: 1, low: 2 } as const
  return advice.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** The 5 slowest steps by median duration, among steps with at least 3 timed runs. */
export function slowSteps(jobs: readonly AdvisorJob[]): Array<{ repo: string; job: string; step: string; p50s: number; runs: number }> {
  const times = new Map<string, { repo: string; job: string; step: string; values: number[] }>()
  for (const j of jobs) {
    for (const s of j.steps ?? []) {
      if (typeof s.seconds !== 'number' || !s.name) continue
      const k = `${j.repo}|${j.jobName}|${s.name}`
      const cur = times.get(k) ?? { repo: j.repo, job: j.jobName, step: s.name, values: [] }
      cur.values.push(s.seconds)
      times.set(k, cur)
    }
  }
  return [...times.values()]
    .filter((t) => t.values.length >= 3)
    .map((t) => ({ repo: t.repo, job: t.job, step: t.step, p50s: percentile(t.values, 50) as number, runs: t.values.length }))
    .sort((a, b) => b.p50s - a.p50s)
    .slice(0, 5)
}
