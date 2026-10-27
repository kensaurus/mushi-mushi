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
 * adviseCiCost (bottom of the file) adds the cost rules of
 * GET /v1/admin/ci/compare: paid_while_idle, public_on_busy_self_hosted,
 * missing_runner_variable, pinned_hosted_cost, tiny_job_rounding,
 * self_hosted_on_public_repo, and from ci-cost-rules.ts (YAML + billed
 * minutes): cron_too_frequent, missing_path_filter, push_reruns_pr_checks,
 * duplicate_gate, no_affected_only, abandoned_pr_minutes, macos_on_pr.
 *
 * no_cancel_in_progress and drafts_not_skipped carry an `autofix` (a PR
 * Mushi can open, `_shared/ci-cost-fix.ts`) when the project is known and
 * the workflow is in a shape that fix edits.
 *
 * Runner names are folded to their base (runnerBaseName): a one-job runner
 * setup registers a new name per job, and is one runner here.
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
import { runnerBaseName, runnerNameMatches } from './ci-infra.ts'
import type { CiCompareExplain, CiCompareMachine, CiCompareRow, RepoVisibility } from './ci-compare-types.ts'
import type { ParsedWorkflow } from './ci-runs-on.ts'
import type { CostFacts } from './ci-cost-facts.ts'
import { adviseCostRules, type CostRulesInput } from './ci-cost-rules.ts'

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
  workflows: Array<{ projectId?: string; repo: string; path: string; text: string }>
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
        autofix: noGroup && w.projectId ? { kind: 'add_concurrency', projectId: w.projectId, repo: w.repo, workflowPath: w.path } : null,
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
        autofix: names.includes('pull_request') && w.projectId ? { kind: 'skip_drafts', projectId: w.projectId, repo: w.repo, workflowPath: w.path } : null,
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
  // One-job runners register a new name per job: judge each base name once,
  // from the first time Mushi saw any of its runners.
  const selfHostedRunners = input.runners.filter((r) => r.kind === 'self_hosted' && r.firstSeenAt)
  for (const members of groupBy(selfHostedRunners, (r) => `${r.repo}|${runnerBaseName(r.name)}`).values()) {
    if (members.some((m) => rogue.has(`${m.repo}|${m.name}`))) continue
    const r = { ...members[0], name: runnerBaseName(members[0].name), firstSeenAt: members.map((m) => m.firstSeenAt as string).sort()[0], labels: [...new Set(members.flatMap((m) => m.labels))] }
    const first = Date.parse(r.firstSeenAt)
    if (!Number.isFinite(first) || nowMs - first > 7 * DAY_MS) continue
    if ([...heartbeatRunners].some((n) => members.some((m) => runnerNameMatches(n, m.name)))) continue
    if (r.labels.some((l) => l.toLowerCase().startsWith('mushi-'))) continue
    // Only "new" when Mushi watched the repo for a day before it appeared:
    // on the first collection every runner is first seen at once.
    const watched = Date.parse(input.repoWatchedSince[r.repo] ?? '')
    if (!Number.isFinite(watched) || first - watched < DAY_MS) continue
    const firstJob = input.jobs
      .filter((j) => j.repo === r.repo && j.runnerName != null && runnerBaseName(j.runnerName) === r.name)
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
    const runner = runnerBaseName(s.runnerName)
    const k = `${s.hostId}|${runner}`
    const cur = ooms.get(k) ?? { runner, hostId: s.hostId, count: 0, repo: s.repo }
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
    const runner = runnerBaseName(s.runnerName)
    const k = `${s.hostId}|${runner}`
    const cur = nearCap.get(k)
    if (!cur || s.memPeakMb / s.memMaxMb > cur.peak / cur.cap) nearCap.set(k, { runner, hostId: s.hostId, peak: s.memPeakMb, cap: s.memMaxMb })
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
    const byRunner = [...groupBy(infraJobs, (j) => (j.runnerName ? runnerBaseName(j.runnerName) : 'no runner')).entries()].sort((a, b) => b[1].length - a[1].length)
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
    // One-job runners of one label are one machine's worth of capacity.
    const names = new Set(jobs.map((j) => j.runnerName).filter((n): n is string => !!n).map(runnerBaseName))
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

// ─────────────────────────────────────────────────────────────────────────────
// Cost advice (Plan 022 Phase 7, ADR 0037): GET /v1/admin/ci/compare
// ─────────────────────────────────────────────────────────────────────────────
//
//   paid_while_idle             a private repo pays for GitHub-hosted minutes
//                               while a self-hosted machine that serves it sits
//                               mostly idle
//   public_on_busy_self_hosted  a public repo queues on a busy self-hosted
//                               machine although GitHub would run it free
//   missing_runner_variable     workflows read vars.X in runs-on, the repo has
//                               no variable X, so every such job falls back to
//                               the GitHub-hosted label
//   pinned_hosted_cost          jobs pinned to GitHub on a private repo, with
//                               the reason from the YAML and what they cost
//   tiny_job_rounding           many jobs under 20 s on paid runners, each
//                               billed a whole minute
//   self_hosted_on_public_repo  a public repo runs on your machine: a pull
//                               request from a fork can run code on it
//
// Like the rules above, each one fires only on data Mushi has.

export interface CostAdvisorInput {
  now: Date
  spanDays: number
  repos: Array<{ projectId: string; repo: string; visibility: RepoVisibility }>
  rows: CiCompareRow[]
  machines: CiCompareMachine[]
  workflows: Array<{ projectId?: string; repo: string; path: string; text: string }>
  /** Repo Actions variable names; null when the list could not be read. */
  variableNames: Record<string, string[] | null>
  parsed: Map<string, ParsedWorkflow[]>
  pinned: CiCompareExplain['pinned']
  tinyJobs: Array<{ repo: string; jobs: number; rawSeconds: number; billedMinutes: number; allJobs: number }>
  /** Billed minutes per workflow job, event, branch kind, PR and step (ci_cost_facts); null = the rules that need them stay silent. */
  facts?: CostFacts | null
  /** ci_pull_requests rows; null when they could not be read. */
  pullRequests?: CostRulesInput['pullRequests']
}

/** Idle below this busy share: a machine that could take more work. */
export const IDLE_BUSY_SHARE = 0.3
/** A pin is worth listing from this much a month (in the row's currency). */
export const PINNED_COST_FLOOR = 1
export const TINY_JOBS_MIN = 10
export const TINY_WASTE_MIN_MINUTES = 10

function fmtMoney(n: number, currency: string): string {
  return currency === 'USD' ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`
}

export function adviseCiCost(input: CostAdvisorInput): CiOverviewAdvice[] {
  const out: CiOverviewAdvice[] = []
  const vis = new Map(input.repos.map((r) => [r.repo, r.visibility]))
  const days = Math.round(input.spanDays * 10) / 10

  for (const [repo, rows] of groupBy(input.rows, (r) => r.repo)) {
    const visibility = vis.get(repo) ?? 'unknown'
    const paid = rows.filter((r) => r.runnerClass === 'github_hosted' && r.costBasis === 'github_list')
    const self = rows.filter((r) => r.runnerClass === 'self_hosted')

    // paid_while_idle
    if (visibility === 'private') {
      const month = paid.reduce((n, r) => n + r.monthCost, 0)
      const minutes = paid.reduce((n, r) => n + r.billedMinutes, 0)
      const idle = input.machines.filter((m) => m.repos.includes(repo) && m.busyShare < IDLE_BUSY_SHARE && m.online !== false)
      if (month > 0 && idle.length > 0) {
        const m = idle.sort((a, b) => a.busyShare - b.busyShare)[0]
        const currency = paid[0].currency
        out.push({
          id: `paid_while_idle:${repo}`,
          severity: month >= 10 ? 'high' : 'medium',
          title: `${repo} pays for GitHub minutes while your runner sits idle`,
          detail: 'This private repo ran jobs on GitHub-hosted runners, which bill after your plan\'s included minutes, while a machine that already runs its jobs was mostly free.',
          evidence: `${minutes} GitHub-hosted minutes in ${days} days (about ${fmtMoney(month, currency)} a month after included minutes, estimated); ${m.name} was busy ${Math.round(m.busyShare * 100)}% of the time.`,
          fix: 'Send the jobs that read a runner variable to your machine (set the repo variable, e.g. LINUX_RUNNER, to its label). Jobs pinned to GitHub move only through a workflow change.',
          repo,
          runner: m.runners[0] ?? null,
        })
      }
    }

    // public_on_busy_self_hosted and self_hosted_on_public_repo
    if (visibility === 'public' && self.length > 0) {
      const slow = self.filter((r) => r.jobs >= 5 && (r.queueP95s ?? 0) > 10 * MIN)
      if (slow.length > 0) {
        const worst = slow.sort((a, b) => (b.queueP95s ?? 0) - (a.queueP95s ?? 0))[0]
        out.push({
          id: `public_on_busy_self_hosted:${repo}`,
          severity: 'medium',
          title: `${repo} waits for your machine although GitHub would run it free`,
          detail: 'Public repositories run standard GitHub-hosted runners at no cost, and those start in seconds. Here jobs queue behind other work on your own machine.',
          evidence: `Queue p95 ${mins(worst.queueP95s as number)} over ${worst.jobs} jobs on ${worst.machine ?? worst.runner ?? 'a self-hosted runner'}.`,
          fix: 'Run this repo on GitHub-hosted runners (remove its runner variable, or use ubuntu-latest), and keep your machine for private repos.',
          repo,
          runner: worst.runner,
        })
      }
      const jobs = self.reduce((n, r) => n + r.jobs, 0)
      out.push({
        id: `self_hosted_on_public_repo:${repo}`,
        severity: 'medium',
        title: `${repo} is public and runs on your own machine`,
        detail: 'A pull request from a fork can change the workflow and run any code on a self-hosted runner, with the access that machine has. GitHub recommends self-hosted runners only for private repositories.',
        evidence: `${jobs} job${jobs === 1 ? '' : 's'} of this public repo ran on ${[...new Set(self.map((r) => r.machine ?? r.runner).filter(Boolean))].join(', ') || 'a self-hosted runner'} in ${days} days.`,
        fix: 'Move it to GitHub-hosted runners (free for public repos), or require approval for every workflow run from outside collaborators (Settings → Actions → General) and never run pull_request_target on that machine.',
        repo,
        runner: self[0].runner,
      })
    }
  }

  // missing_runner_variable
  for (const [repo, parsed] of input.parsed) {
    const names = input.variableNames[repo]
    if (!names) continue
    const have = new Set(names.map((n) => n.toUpperCase()))
    const wanted = new Map<string, { jobs: number; workflows: Set<string>; fallback: string | null }>()
    for (const wf of parsed) {
      for (const j of wf.jobs) {
        if (j.kind !== 'follows_variable') continue
        for (const v of j.variables) {
          if (have.has(v.toUpperCase())) continue
          const e = wanted.get(v) ?? { jobs: 0, workflows: new Set<string>(), fallback: null }
          e.jobs++
          e.workflows.add(wf.path)
          e.fallback = e.fallback ?? j.fallbackLabel
          wanted.set(v, e)
        }
      }
    }
    const visibility = vis.get(repo) ?? 'unknown'
    const hasSelf = input.machines.some((m) => m.repos.includes(repo))
    for (const [v, e] of wanted) {
      out.push({
        id: `missing_runner_variable:${repo}:${v}`,
        severity: visibility === 'private' ? 'high' : 'low',
        title: `${repo} has no ${v} variable, so its jobs run on ${e.fallback ?? 'the fallback runner'}`,
        detail: `${e.jobs} job${e.jobs === 1 ? '' : 's'} pick their runner from vars.${v}. The repository has no variable with that name${visibility === 'private' ? ', so they run on paid GitHub-hosted runners' : ''}${hasSelf ? ' even though a self-hosted runner has served this repo' : ''}.`,
        evidence: `vars.${v} is read in ${[...e.workflows].join(', ')}; the repo's Actions variables do not include ${v}.`,
        fix: `Create the repo variable ${v} (Settings → Secrets and variables → Actions → Variables) with your runner's label, or delete the reference if GitHub-hosted is intended.`,
        repo,
      })
    }
  }

  // pinned_hosted_cost
  for (const [repo, pins] of groupBy(input.pinned.filter((p) => p.monthCost >= PINNED_COST_FLOOR), (p) => p.repo)) {
    const total = pins.reduce((n, p) => n + p.monthCost, 0)
    const currency = input.rows.find((r) => r.repo === repo)?.currency ?? 'USD'
    out.push({
      id: `pinned_hosted_cost:${repo}`,
      severity: 'low',
      title: `Jobs pinned to GitHub cost ${repo} about ${fmtMoney(total, currency)} a month`,
      detail: 'These jobs name a GitHub-hosted runner directly, so no runner variable moves them. The reason is the comment in the workflow.',
      evidence: pins.slice(0, 5).map((p) => `${p.workflow} · ${p.job}: ${fmtMoney(p.monthCost, currency)}${p.reason ? ` (“${p.reason}”)` : ' (no reason given)'}`).join('; '),
      fix: 'Keep them where the reason still holds. To move one, fix the reason first, then change its runs-on in a workflow pull request.',
      repo,
    })
  }

  // tiny_job_rounding
  for (const [repo, list] of groupBy(input.tinyJobs, (t) => t.repo)) {
    const jobs = list.reduce((n, t) => n + t.jobs, 0)
    const raw = list.reduce((n, t) => n + t.rawSeconds, 0) / 60
    const waste = jobs - raw
    if (jobs < TINY_JOBS_MIN || waste < TINY_WASTE_MIN_MINUTES) continue
    out.push({
      id: `tiny_job_rounding:${repo}`,
      severity: 'low',
      title: `${repo} has many very short jobs, each billed a full minute`,
      detail: 'GitHub rounds every job up to a whole minute, so a 7-second check costs as much as a 60-second one.',
      evidence: `${jobs} jobs under 20 s in ${days} days ran ${raw.toFixed(1)} minutes and billed ${jobs}.`,
      fix: 'Run the short checks as steps of one job instead of separate jobs.',
      repo,
    })
  }

  out.push(
    ...adviseCostRules({
      now: input.now,
      spanDays: input.spanDays,
      repos: input.repos,
      workflows: input.workflows,
      facts: input.facts ?? null,
      pullRequests: input.pullRequests ?? null,
    }),
  )

  const rank = { high: 0, medium: 1, low: 2 } as const
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.monthSavingUsd ?? 0) - (a.monthSavingUsd ?? 0))
}
