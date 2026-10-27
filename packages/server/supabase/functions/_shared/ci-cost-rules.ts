/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost-rules.ts
 * PURPOSE: The CI cost rules that need the workflow YAML together with the
 *          billed minutes Mushi recorded (2026-10-27), added to adviseCiCost
 *          (ci-advisor.ts) for GET /v1/admin/ci/compare:
 *
 *   cron_too_frequent      a scheduled workflow runs more often than weekly
 *                          (autofix weekly_cron)
 *   missing_path_filter    a pull_request workflow without paths filters ran
 *                          on pull requests that changed only documentation
 *                          (autofix ignore_docs_paths)
 *   push_reruns_pr_checks  jobs that ran on the pull request ran again on
 *                          push to the default branch
 *   duplicate_gate         the same `run:` command in two jobs on one event
 *   no_affected_only       a turbo / nx monorepo runs every task on pull
 *                          requests (no --affected, no --filter)
 *   abandoned_pr_minutes   minutes billed on pull requests closed unmerged
 *   macos_on_pr            macOS jobs on pull requests
 *
 * Each rule needs its evidence: the YAML (connector snapshot) and the job
 * facts (ci_cost_facts), and the pull request states for the two PR rules.
 * Without them the rule is silent. `monthSavingUsd` is the window's billed
 * minutes at GitHub's list price, scaled to 30 days: GitHub-hosted minutes
 * on a repo that is not public; public repos and self-hosted runners are 0.
 * It is null where Mushi cannot measure what the fix would save
 * (no_affected_only, and duplicate_gate without step timings). Minutes cover
 * the jobs Mushi recorded, which the evidence says.
 *
 * Pure apart from the YAML parser.
 */

import { parse as parseYaml } from 'npm:yaml@2'
import type { CiCostAutofix, CiOverviewAdvice } from './ci-overview-types.ts'
import type { RepoVisibility } from './ci-compare-types.ts'
import { isMushiAgentBranch } from './ci-billing.ts'
import { monthUsd, usdForMinutes, type CostFactEvent, type CostFacts } from './ci-cost-facts.ts'
import { predictableRefusals } from './ci-cost-fix.ts'

export interface CostRulesInput {
  now: Date
  spanDays: number
  repos: Array<{ repo: string; visibility: RepoVisibility }>
  workflows: Array<{ projectId?: string; repo: string; path: string; text: string }>
  facts: CostFacts | null
  /** ci_pull_requests rows; null when they could not be read. */
  pullRequests: Array<{ repo: string; number: number; merged: boolean; state: string; closedAt: string | null; headRef: string | null; docsOnly: boolean | null }> | null
}

const PR_EVENTS = new Set(['pull_request', 'pull_request_target'])
const CODE_EVENTS = new Set(['push', 'pull_request', 'pull_request_target', 'merge_group'])
/** Advice per rule and repo is capped so one repo cannot flood the list. */
const MAX_PER_REPO = 5
const DAY_MS = 24 * 60 * 60_000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toFixed(2)}`
const lc = (s: string) => s.toLowerCase()

// ─────────────────────────────────────────────────────────────────────────────
// Workflow reading
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadStep {
  name: string | null
  run: string | null
}

export interface ReadJob {
  id: string
  name: string | null
  steps: ReadStep[]
}

export interface ReadWorkflow {
  projectId?: string
  repo: string
  path: string
  name: string | null
  triggers: string[]
  /** The `on:` value for a trigger (an object, or null for a bare name). */
  triggerConfig: (t: string) => Obj | null
  crons: string[]
  jobs: ReadJob[]
  /** Why ci-cost-fix-worker would refuse concurrency or a weekly cron here (it looks like a deploy), else null. */
  deploy: string | null
  /** A job that looks like a required check, so the worker refuses the docs filter; else null. */
  requiredLooking: string | null
}

function triggersOf(wf: Obj): { names: string[]; config: (t: string) => Obj | null } {
  const on = wf.on ?? wf[true as unknown as string]
  if (typeof on === 'string') return { names: [on], config: () => null }
  if (Array.isArray(on)) return { names: on.filter((x): x is string => typeof x === 'string'), config: () => null }
  if (isObj(on)) return { names: Object.keys(on), config: (t) => (isObj(on[t]) ? (on[t] as Obj) : null) }
  return { names: [], config: () => null }
}

/** The parts of a workflow file the cost rules read; null when it is not valid YAML. */
export function readWorkflow(w: CostRulesInput['workflows'][number]): ReadWorkflow | null {
  let doc: unknown
  try {
    doc = parseYaml(w.text)
  } catch {
    return null
  }
  if (!isObj(doc) || !isObj(doc.jobs)) return null
  const t = triggersOf(doc)
  const on = doc.on ?? doc[true as unknown as string]
  const schedule = isObj(on) ? on.schedule : null
  const crons = Array.isArray(schedule) ? schedule.map((s) => (isObj(s) && typeof s.cron === 'string' ? s.cron.trim() : '')).filter(Boolean) : []
  const jobs: ReadJob[] = []
  for (const [id, j] of Object.entries(doc.jobs as Obj)) {
    if (!isObj(j)) continue
    const steps = Array.isArray(j.steps)
      ? j.steps.filter(isObj).map((s) => ({ name: typeof s.name === 'string' ? s.name : null, run: typeof s.run === 'string' ? s.run : null }))
      : []
    jobs.push({ id, name: typeof j.name === 'string' ? j.name : null, steps })
  }
  const refusals = predictableRefusals(w.text, w.path)
  return { projectId: w.projectId, repo: w.repo, path: w.path, name: typeof doc.name === 'string' ? doc.name : null, triggers: t.names, triggerConfig: t.config, crons, jobs, ...refusals }
}

/** GitHub names a run after the workflow's `name:`, or its path when there is none. */
export function workflowMatches(wf: Pick<ReadWorkflow, 'name' | 'path'>, workflowName: string): boolean {
  return workflowName === (wf.name ?? wf.path) || workflowName === wf.path
}

/** A recorded job name belongs to a YAML job (matrix jobs add " (…)"). */
export function jobMatches(job: Pick<ReadJob, 'id' | 'name'>, jobName: string): boolean {
  const display = (job.name ?? job.id).trim()
  const prefix = display.includes('${{') ? display.slice(0, display.indexOf('${{')).trim() : display
  if (!prefix) return false
  return jobName === display || jobName === prefix || jobName.startsWith(`${prefix} (`) || (display.includes('${{') && jobName.startsWith(prefix))
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron
// ─────────────────────────────────────────────────────────────────────────────

const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/** The values one cron field matches, or null when it cannot be read. */
function cronField(field: string, min: number, max: number, names: Record<string, number> = {}): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    const step = m[2] ? Number(m[2]) : 1
    if (!(step >= 1)) return null
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const val = (s: string) => (s.toLowerCase() in names ? names[s.toLowerCase()] : /^\d+$/.test(s) ? Number(s) : NaN)
      const [a, b] = m[1].split('-')
      lo = val(a)
      hi = b !== undefined ? val(b) : m[2] ? max : lo
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < min || hi > max || lo > hi) return null
    }
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v)
  }
  return out
}

/**
 * How many times a week a 5-field cron runs (GitHub's schedule syntax). Null
 * for one it cannot read, or one limited to some months (it is not weekly).
 * Day of month and day of week both set: either matches, as in cron.
 */
export function cronRunsPerWeek(expr: string): number | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [mi, ho, dom, mon, dow] = f
  if (mon !== '*') return null
  const minutes = cronField(mi, 0, 59)
  const hours = cronField(ho, 0, 23)
  const days = cronField(dom, 1, 31)
  const weekdays = cronField(dow, 0, 7, DOW_NAMES)
  if (!minutes || !hours || !days || !weekdays) return null
  const perDay = minutes.size * hours.size
  const domAll = dom === '*'
  const dowAll = dow === '*'
  if (domAll && dowAll) return perDay * 7
  const fromDow = dowAll ? 0 : weekdays.size
  const fromDom = domAll ? 0 : (days.size * 7) / 30.44
  return Math.round(perDay * (fromDow + fromDom) * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// The rules
// ─────────────────────────────────────────────────────────────────────────────

function autofix(kind: CiCostAutofix['kind'], w: ReadWorkflow): CiCostAutofix | null {
  return w.projectId ? { kind, projectId: w.projectId, repo: w.repo, workflowPath: w.path } : null
}

function severityFor(monthSaving: number | null, high = 25, medium = 5): CiOverviewAdvice['severity'] {
  if (monthSaving == null) return 'low'
  return monthSaving >= high ? 'high' : monthSaving >= medium ? 'medium' : 'low'
}

function mins(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} min`
}

/** A run command reduced to compare across files: trimmed, inner whitespace collapsed. */
function normalizeRun(run: string): string {
  return run.trim().replace(/\s+/g, ' ')
}

const TRIVIAL_RUN = /^(?:cd |echo |mkdir |export |git |corepack |chmod |ls\b|cat |npm ci\b|npm install\b|pnpm install\b|pnpm i\b|yarn(?: install)?\b|bun install\b|npx playwright install\b|pnpm exec playwright install\b|sudo apt)/

export function adviseCostRules(input: CostRulesInput): CiOverviewAdvice[] {
  const out: CiOverviewAdvice[] = []
  const facts = input.facts
  if (!facts) return out
  const vis = new Map(input.repos.map((r) => [lc(r.repo), r.visibility]))
  const visOf = (repo: string): RepoVisibility => vis.get(lc(repo)) ?? 'unknown'
  const days = Math.round(input.spanDays * 10) / 10
  const priced = (repo: string, list: ReadonlyArray<Pick<CostFactEvent, 'billed_minutes' | 'os' | 'runner_class'>>) =>
    list.reduce((n, e) => n + usdForMinutes(e.billed_minutes, e.os, e.runner_class, visOf(repo)), 0)
  const workflows = input.workflows.map(readWorkflow).filter((w): w is ReadWorkflow => !!w)
  const eventsOf = (w: ReadWorkflow) => facts.events.filter((e) => lc(e.repo) === lc(w.repo) && workflowMatches(w, e.workflow_name))
  const perRepo = new Map<string, number>()
  const room = (rule: string, repo: string) => {
    const k = `${rule}|${lc(repo)}`
    const n = perRepo.get(k) ?? 0
    perRepo.set(k, n + 1)
    return n < MAX_PER_REPO
  }

  // cron_too_frequent
  for (const w of workflows) {
    if (w.crons.length === 0) continue
    const perWeek = w.crons.map(cronRunsPerWeek)
    if (perWeek.some((n) => n == null)) continue
    const weekly = (perWeek as number[]).reduce((a, b) => a + b, 0)
    if (weekly <= 1) continue
    const sched = eventsOf(w).filter((e) => e.event === 'schedule')
    const runs = Math.max(0, ...sched.map((e) => e.runs))
    const billed = sched.reduce((n, e) => n + e.billed_minutes, 0)
    if (runs === 0 || billed === 0) continue
    // Keep one run a week: the share of the recorded runs that goes away.
    const keep = Math.min(1, input.spanDays / 7 / runs)
    const amount = priced(w.repo, sched) * (1 - keep)
    const saving = monthUsd(amount, input.spanDays)
    if (!room('cron_too_frequent', w.repo)) continue
    out.push({
      id: `cron_too_frequent:${w.repo}:${w.path}`,
      severity: severityFor(saving),
      title: `${w.path} runs on a schedule ${Math.round(weekly)} times a week`,
      detail: 'A scheduled workflow runs whether or not anything changed. Checks like audits, freshness and link scans rarely need more than a weekly run.',
      evidence: `${w.repo}/${w.path}: ${w.crons.map((c) => `cron "${c}"`).join(', ')} is about ${Math.round(weekly)} runs a week; Mushi recorded ${runs} scheduled runs that billed ${mins(billed)} in ${days} days.`,
      fix: w.deploy
        ? `This workflow looks like it deploys or releases (${w.deploy}), so Mushi offers no one-click change: some daily schedules drive staged rollouts on purpose. If this one does not, run it once a week by hand: keep its minute and hour and name one weekday, e.g. \`'30 4 * * 1'\`.`
        : "Run it once a week: keep its minute and hour and name one weekday, e.g. `'30 4 * * 1'` for 04:30 UTC on Mondays. Keep `workflow_dispatch:` so you can still run it by hand. Leave release and rollout schedules as they are.",
      repo: w.repo,
      monthSavingUsd: saving,
      // ci-cost-fix-worker refuses a weekly cron on a deploy or release workflow.
      autofix: w.deploy ? null : autofix('weekly_cron', w),
    })
  }

  // missing_path_filter
  if (input.pullRequests) {
    const prByKey = new Map(input.pullRequests.map((p) => [`${lc(p.repo)}#${p.number}`, p]))
    for (const w of workflows) {
      const prTrigger = w.triggers.find((t) => t === 'pull_request') ?? null
      if (!prTrigger) continue
      const cfg = w.triggerConfig(prTrigger)
      if (cfg && ('paths' in cfg || 'paths-ignore' in cfg)) continue
      const runs = facts.prs.filter((p) => lc(p.repo) === lc(w.repo) && workflowMatches(w, p.workflow_name))
      const prNumbers = [...new Set(runs.map((p) => p.pr_number))]
      const docs = prNumbers.filter((n) => prByKey.get(`${lc(w.repo)}#${n}`)?.docsOnly === true)
      if (docs.length === 0) continue
      const checked = prNumbers.filter((n) => prByKey.get(`${lc(w.repo)}#${n}`)?.docsOnly != null).length
      const docRuns = runs.filter((p) => docs.includes(p.pr_number))
      const billed = docRuns.reduce((n, p) => n + p.billed_minutes, 0)
      const saving = monthUsd(priced(w.repo, docRuns), input.spanDays)
      if (!room('missing_path_filter', w.repo)) continue
      out.push({
        id: `missing_path_filter:${w.repo}:${w.path}`,
        severity: severityFor(saving),
        title: `Documentation-only pull requests run ${w.path}`,
        detail: 'This workflow runs on every pull request, including ones that change only Markdown or docs, where its builds and tests check nothing new.',
        evidence: `${docs.length} of the ${checked} pull requests Mushi checked that ran ${w.path} in ${days} days changed only documentation (${docs.slice(0, 5).map((n) => `#${n}`).join(', ')}); they billed ${mins(billed)}.`,
        fix: "Under `pull_request:` add\npaths-ignore:\n  - '**/*.md'\n  - '**/*.mdx'\n  - 'docs/**'\n  - 'LICENSE*'\n  - '.github/ISSUE_TEMPLATE/**'\nIf a required check must still report, give the skipped case a tiny job instead.",
        repo: w.repo,
        monthSavingUsd: saving,
        // GitHub refuses paths and paths-ignore on one event, and the fix filters push too;
        // the worker also refuses a workflow whose job looks like a required check.
        autofix: pushHasPaths(w) || w.requiredLooking ? null : autofix('ignore_docs_paths', w),
      })
    }
  }

  // push_reruns_pr_checks
  {
    const groups = new Map<string, { repo: string; workflow: string; jobs: Set<string>; events: CostFactEvent[] }>()
    const prJobs = new Set(facts.events.filter((e) => PR_EVENTS.has(e.event) && e.jobs > 0).map((e) => `${lc(e.repo)}|${e.workflow_name}|${e.job_name}`))
    for (const e of facts.events) {
      if (e.event !== 'push' || e.branch_kind !== 'default' || e.billed_minutes <= 0) continue
      if (!prJobs.has(`${lc(e.repo)}|${e.workflow_name}|${e.job_name}`)) continue
      const k = `${lc(e.repo)}|${e.workflow_name}`
      const g = groups.get(k) ?? { repo: e.repo, workflow: e.workflow_name, jobs: new Set<string>(), events: [] }
      g.jobs.add(e.job_name)
      g.events.push(e)
      groups.set(k, g)
    }
    for (const g of groups.values()) {
      const billed = g.events.reduce((n, e) => n + e.billed_minutes, 0)
      const saving = monthUsd(priced(g.repo, g.events), input.spanDays)
      if (!room('push_reruns_pr_checks', g.repo)) continue
      out.push({
        id: `push_reruns_pr_checks:${g.repo}:${g.workflow}`,
        severity: severityFor(saving),
        title: `${g.workflow} runs the pull request's checks again after the merge`,
        detail: 'These jobs already passed on the pull request, then ran again on the push to the default branch. With one merge at a time the second run tests almost the same code.',
        evidence: `${[...g.jobs].slice(0, 5).join(', ')}${g.jobs.size > 5 ? ` and ${g.jobs.size - 5} more` : ''} ran on pull requests and again on push to the default branch: ${mins(billed)} on the default branch in ${days} days (jobs Mushi recorded).`,
        fix: 'Test the merged result once instead: turn on a merge queue (add the `merge_group` trigger, GitHub tests a group of pull requests together) or merge in batches (Mushi release trains run CI once per batch). Then limit `push:` on the default branch to what must run after a merge, such as the deploy.',
        repo: g.repo,
        monthSavingUsd: saving,
        autofix: null,
      })
    }
  }

  // duplicate_gate
  for (const [repoKey, list] of groupByRepo(workflows)) {
    const seen = new Map<string, Array<{ w: ReadWorkflow; job: ReadJob; step: ReadStep; triggers: Set<string> }>>()
    for (const w of list) {
      const triggers = new Set(w.triggers.filter((t) => CODE_EVENTS.has(t)))
      if (triggers.size === 0) continue
      for (const job of w.jobs) {
        for (const step of job.steps) {
          if (!step.run) continue
          const cmd = normalizeRun(step.run)
          if (cmd.length < 6 || TRIVIAL_RUN.test(cmd)) continue
          seen.set(cmd, [...(seen.get(cmd) ?? []), { w, job, step, triggers }])
        }
      }
    }
    for (const [cmd, hits] of seen) {
      const distinct = hits.filter((h, i) => hits.findIndex((o) => o.w.path === h.w.path && o.job.id === h.job.id) === i)
      if (distinct.length < 2) continue
      const shared = [...distinct[0].triggers].find((t) => distinct.slice(1).some((h) => h.triggers.has(t)))
      if (!shared) continue
      const pair = distinct.filter((h) => h.triggers.has(shared)).slice(0, 2)
      // Price the cheaper copy (the one to drop) from its recorded step times.
      const costs = pair.map((h) => {
        const stepName = h.step.name ?? `Run ${h.step.run!.trim().split('\n')[0]}`
        const rows = facts.steps.filter((s) => lc(s.repo) === repoKey && workflowMatches(h.w, s.workflow_name) && jobMatches(h.job, s.job_name) && s.step_name === stepName)
        return rows.length === 0 ? null : rows.reduce((n, s) => n + usdForMinutes(s.seconds / 60, s.os, 'github_hosted', visOf(h.w.repo)), 0)
      })
      const known = costs.filter((c): c is number => c != null)
      const saving = known.length > 0 ? monthUsd(Math.min(...known), input.spanDays) : null
      const repo = pair[0].w.repo
      if (!room('duplicate_gate', repo)) continue
      out.push({
        id: `duplicate_gate:${repo}:${pair.map((h) => `${h.w.path}#${h.job.id}`).join('+')}`.slice(0, 300),
        severity: severityFor(saving),
        title: `The same check runs twice on ${shared}`,
        detail: 'Two jobs triggered by the same event run the same command, so every such event pays for it twice.',
        evidence: `\`${cmd.slice(0, 120)}\` runs in ${pair.map((h) => `${h.w.path} · ${h.job.name ?? h.job.id}`).join(' and ')}, both on ${shared}.${saving == null ? ' Mushi has no step times for it yet, so the saving is not priced.' : ''}`,
        fix: 'Keep the command in one job and delete it from the other. If both workflows need it, make one depend on the other (`needs:`) or turn the shared part into a reusable workflow called once.',
        repo,
        monthSavingUsd: saving,
        autofix: null,
      })
    }
  }

  // no_affected_only
  for (const w of workflows) {
    if (!w.triggers.some((t) => PR_EVENTS.has(t))) continue
    for (const job of w.jobs) {
      const cmd = job.steps.map((s) => s.run ?? '').find((r) => {
        const turbo = /\bturbo(?:\s+run)?\s+[\w:@/-]+/.test(r) && !/--affected\b|--filter\b|\s-F\s/.test(r)
        const nx = /\bnx\s+run-many\b/.test(r)
        return turbo || nx
      })
      if (!cmd) continue
      const prEvents = eventsOf(w).filter((e) => PR_EVENTS.has(e.event) && jobMatches(job, e.job_name))
      const billed = prEvents.reduce((n, e) => n + e.billed_minutes, 0)
      if (billed === 0) continue
      const atStake = monthUsd(priced(w.repo, prEvents), input.spanDays)
      if (!room('no_affected_only', w.repo)) continue
      const nx = /\bnx\s+run-many\b/.test(cmd)
      out.push({
        id: `no_affected_only:${w.repo}:${w.path}:${job.id}`,
        severity: 'low',
        title: `${w.path} builds every package on each pull request`,
        detail: `This monorepo job runs ${nx ? 'nx run-many' : 'turbo'} over every package. On a pull request only the packages it changed, and the ones that depend on them, need to run.`,
        evidence: `${w.repo}/${w.path} · ${job.name ?? job.id} runs \`${normalizeRun(cmd).slice(0, 100)}\` on pull requests: ${mins(billed)} in ${days} days (${usd(atStake)} a month at list price). How much --affected saves depends on how many packages a pull request touches, so Mushi does not price it.`,
        fix: nx
          ? 'Use `nx affected -t <targets>` on pull requests (with `fetch-depth: 0` and nrwl/nx-set-shas so it knows the base).'
          : 'Use `turbo run <tasks> --affected` on pull requests, with `fetch-depth: 0` on actions/checkout: turbo compares against GITHUB_BASE_REF and runs everything on a shallow clone.',
        repo: w.repo,
        monthSavingUsd: null,
        autofix: null,
      })
    }
  }

  // abandoned_pr_minutes
  if (input.pullRequests) {
    const since = input.now.getTime() - input.spanDays * DAY_MS
    const minutesByPr = new Map<string, typeof facts.prs>()
    for (const p of facts.prs) minutesByPr.set(`${lc(p.repo)}#${p.pr_number}`, [...(minutesByPr.get(`${lc(p.repo)}#${p.pr_number}`) ?? []), p])
    const byRepo = new Map<string, Array<{ number: number; agent: boolean; rows: typeof facts.prs }>>()
    for (const pr of input.pullRequests) {
      if (pr.state !== 'closed' || pr.merged || !pr.closedAt || !(Date.parse(pr.closedAt) >= since)) continue
      const rows = minutesByPr.get(`${lc(pr.repo)}#${pr.number}`)
      if (!rows?.length) continue
      byRepo.set(lc(pr.repo), [...(byRepo.get(lc(pr.repo)) ?? []), { number: pr.number, agent: isMushiAgentBranch(pr.headRef), rows }])
    }
    for (const list of byRepo.values()) {
      const rows = list.flatMap((p) => p.rows)
      const billed = rows.reduce((n, p) => n + p.billed_minutes, 0)
      if (billed < 10) continue
      const repo = rows[0].repo
      const agentMinutes = list.filter((p) => p.agent).flatMap((p) => p.rows).reduce((n, p) => n + p.billed_minutes, 0)
      const saving = monthUsd(priced(repo, rows), input.spanDays)
      out.push({
        id: `abandoned_pr_minutes:${repo}`,
        severity: severityFor(saving),
        title: `Pull requests nobody merged billed ${mins(billed)} on ${repo}`,
        detail: 'Every push to a pull request runs its CI, and a pull request that is closed without merging paid for all of it. Coding agents open many of these.',
        evidence: `${list.length} pull request${list.length === 1 ? '' : 's'} closed without merging in ${days} days billed ${mins(billed)}${agentMinutes > 0 ? `, ${mins(agentMinutes)} of it on Mushi agent branches` : ''} (${list.slice(0, 6).map((p) => `#${p.number}`).join(', ')}${list.length > 6 ? ', …' : ''}; jobs Mushi recorded).`,
        fix: 'Keep agent pull requests as drafts until they are ready and skip drafts in CI (`types: [opened, synchronize, reopened, ready_for_review]` plus `if: github.event.pull_request.draft == false`), cancel superseded runs with a concurrency group, and close a pull request as soon as it is superseded. Release trains then run CI once per batch.',
        repo,
        monthSavingUsd: saving,
        autofix: null,
      })
    }
  }

  // macos_on_pr
  {
    const groups = new Map<string, { repo: string; workflow: string; jobs: Set<string>; events: CostFactEvent[] }>()
    for (const e of facts.events) {
      if (e.os !== 'macos' || e.runner_class !== 'github_hosted' || !PR_EVENTS.has(e.event) || e.billed_minutes <= 0) continue
      const k = `${lc(e.repo)}|${e.workflow_name}`
      const g = groups.get(k) ?? { repo: e.repo, workflow: e.workflow_name, jobs: new Set<string>(), events: [] }
      g.jobs.add(e.job_name)
      g.events.push(e)
      groups.set(k, g)
    }
    for (const g of groups.values()) {
      const billed = g.events.reduce((n, e) => n + e.billed_minutes, 0)
      const saving = monthUsd(priced(g.repo, g.events), input.spanDays)
      if (!room('macos_on_pr', g.repo)) continue
      out.push({
        id: `macos_on_pr:${g.repo}:${g.workflow}`,
        severity: severityFor(saving, 20, 3),
        title: `${g.workflow} runs macOS jobs on pull requests`,
        detail: 'A GitHub-hosted macOS minute costs about ten Linux minutes. Pull requests rarely need a macOS build: a Linux job can lint, type-check and unit-test the same code.',
        evidence: `${[...g.jobs].slice(0, 4).join(', ')} on pull requests billed ${mins(billed)} of macOS in ${days} days (jobs Mushi recorded).`,
        fix: 'Run the macOS jobs only on release intent: a tag, a release branch, `workflow_dispatch`, or a `release` label (`if: contains(github.event.pull_request.labels.*.name, \'release\')`). Keep pull requests on Linux.',
        repo: g.repo,
        monthSavingUsd: saving,
        autofix: null,
      })
    }
  }

  return out.map((a) => (a.monthSavingUsd != null ? { ...a, monthSavingUsd: r2(a.monthSavingUsd) } : a))
}

function pushHasPaths(w: ReadWorkflow): boolean {
  const push = w.triggerConfig('push')
  return !!push && ('paths' in push || 'paths-ignore' in push)
}

function groupByRepo(workflows: ReadWorkflow[]): Map<string, ReadWorkflow[]> {
  const out = new Map<string, ReadWorkflow[]>()
  for (const w of workflows) out.set(lc(w.repo), [...(out.get(lc(w.repo)) ?? []), w])
  return out
}
