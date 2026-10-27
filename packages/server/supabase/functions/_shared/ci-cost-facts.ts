/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost-facts.ts
 * PURPOSE: The job facts behind the CI cost rules and the agent PR share
 *          (2026-10-27): billed minutes from the jobs Mushi recorded, per
 *
 *   events  workflow job × event × branch kind (default / agent / other) ×
 *           runner class × OS, with jobs and runs
 *   prs     pull request × workflow × runner class × OS
 *   steps   GitHub-hosted job step: runs and total seconds
 *
 *   aggregateCostFacts  the TypeScript mirror of the SQL function
 *                       ci_cost_facts (migration 20261027091500): the tested
 *                       spec, and the fallback until it is applied.
 *   readCostFacts       the SQL function's jsonb, read defensively.
 *   loadCostFacts       the SQL function, else the newest jobs in TypeScript.
 *                       It never throws: on an error the facts are null and
 *                       the note says why, so the rules that need them stay
 *                       silent and the rest of the page still renders.
 *   usdForMinutes / monthUsd / paidMinutes  pricing at GitHub's list price
 *                       (ci-minutes.ts): GitHub-hosted on a repo that is not
 *                       public; self-hosted and public repos are 0.
 *
 * Minutes are estimated (each job's time rounded up to a whole minute, at
 * least 1), and only cover the jobs Mushi recorded: when the collector's
 * call budget runs out a run can be missed.
 */

import { billedMinutesOf, GITHUB_RUNNER_RATES, runnerOsOf, type RunnerOs } from './ci-minutes.ts'
import { runnerKindOf, type CiRunnerKind } from './ci-infra.ts'
import { isMushiAgentBranch } from './ci-billing.ts'
import { readAllPages } from './paged-read.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export type BranchKind = 'default' | 'agent' | 'other'

export interface CostFactEvent {
  project_id: string
  repo: string
  workflow_name: string
  job_name: string
  event: string
  branch_kind: BranchKind
  runner_class: CiRunnerKind
  os: RunnerOs
  jobs: number
  runs: number
  billed_minutes: number
}

export interface CostFactPr {
  project_id: string
  repo: string
  pr_number: number
  workflow_name: string
  runner_class: CiRunnerKind
  os: RunnerOs
  jobs: number
  billed_minutes: number
}

export interface CostFactStep {
  project_id: string
  repo: string
  workflow_name: string
  job_name: string
  os: RunnerOs
  step_name: string
  runs: number
  seconds: number
}

export interface CostFacts {
  events: CostFactEvent[]
  prs: CostFactPr[]
  steps: CostFactStep[]
  jobs: number
}

/** The ci_jobs columns the mirror reads. */
export interface CostFactJobRow {
  project_id: string
  repo: string
  workflow_name: string | null
  job_name: string
  event: string | null
  head_branch: string | null
  pr_number: number | null
  run_id: number
  status: string
  started_at: string | null
  duration_seconds: number | null
  runner_kind: string | null
  runner_labels: string[] | null
  runner_name: string | null
  runner_group_name: string | null
  steps: Array<{ name?: unknown; seconds?: unknown }> | null
  gh_created_at: string
}

export const COST_FACT_JOB_COLUMNS =
  'id, project_id, repo, workflow_name, job_name, event, head_branch, pr_number, run_id, status, started_at, duration_seconds, runner_kind, runner_labels, runner_name, runner_group_name, steps, gh_created_at'

/** Jobs the fallback reads when ci_cost_facts is not applied yet. */
export const MAX_FACT_JOBS = 10_000

export function branchKindOf(branch: string | null): BranchKind {
  if (branch === 'main' || branch === 'master') return 'default'
  return isMushiAgentBranch(branch) ? 'agent' : 'other'
}

function classOf(j: CostFactJobRow): CiRunnerKind {
  if (j.runner_kind === 'self_hosted' || j.runner_kind === 'github_hosted') return j.runner_kind
  return runnerKindOf({ labels: j.runner_labels ?? [], runner_name: j.runner_name, runner_group_name: j.runner_group_name })
}

function billedOf(j: CostFactJobRow): number {
  if (j.status !== 'completed' || j.started_at == null || typeof j.duration_seconds !== 'number' || j.duration_seconds < 0) return 0
  return billedMinutesOf(j.duration_seconds)
}

export function aggregateCostFacts(rows: readonly CostFactJobRow[], window?: { from: Date; to: Date }): CostFacts {
  const events = new Map<string, CostFactEvent & { runIds: Set<number> }>()
  const prs = new Map<string, CostFactPr>()
  const steps = new Map<string, CostFactStep>()
  let count = 0
  for (const j of rows) {
    const created = Date.parse(j.gh_created_at)
    if (window && (!(created >= window.from.getTime()) || created > window.to.getTime())) continue
    count++
    const cls = classOf(j)
    const os = runnerOsOf({ labels: j.runner_labels ?? [], runner_name: j.runner_name })
    const wf = j.workflow_name ?? '(unnamed workflow)'
    const event = j.event ?? ''
    const kind = branchKindOf(j.head_branch)
    const billed = billedOf(j)

    const ek = [j.project_id, j.repo, wf, j.job_name, event, kind, cls, os].join('|')
    const e = events.get(ek) ?? { project_id: j.project_id, repo: j.repo, workflow_name: wf, job_name: j.job_name, event, branch_kind: kind, runner_class: cls, os, jobs: 0, runs: 0, billed_minutes: 0, runIds: new Set<number>() }
    e.jobs++
    e.runIds.add(Number(j.run_id))
    e.billed_minutes += billed
    events.set(ek, e)

    if (j.pr_number != null && billed > 0) {
      const pk = [j.project_id, j.repo, j.pr_number, wf, cls, os].join('|')
      const p = prs.get(pk) ?? { project_id: j.project_id, repo: j.repo, pr_number: j.pr_number, workflow_name: wf, runner_class: cls, os, jobs: 0, billed_minutes: 0 }
      p.jobs++
      p.billed_minutes += billed
      prs.set(pk, p)
    }

    if (cls === 'github_hosted' && Array.isArray(j.steps)) {
      for (const s of j.steps) {
        const name = typeof s?.name === 'string' ? s.name : ''
        const seconds = typeof s?.seconds === 'number' && Number.isFinite(s.seconds) && s.seconds >= 0 ? s.seconds : null
        if (!name || seconds == null) continue
        const sk = [j.project_id, j.repo, wf, j.job_name, os, name].join('|')
        const st = steps.get(sk) ?? { project_id: j.project_id, repo: j.repo, workflow_name: wf, job_name: j.job_name, os, step_name: name, runs: 0, seconds: 0 }
        st.runs++
        st.seconds += seconds
        steps.set(sk, st)
      }
    }
  }
  return {
    events: [...events.values()].map(({ runIds, ...e }) => ({ ...e, runs: runIds.size })),
    prs: [...prs.values()],
    steps: [...steps.values()],
    jobs: count,
  }
}

const nnum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const cls = (v: unknown): CiRunnerKind => (v === 'self_hosted' || v === 'github_hosted' ? v : 'unknown')
const osOf = (v: unknown): RunnerOs => (v === 'windows' || v === 'macos' ? v : 'linux')
const kindOf = (v: unknown): BranchKind => (v === 'default' || v === 'agent' ? v : 'other')
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])

/** The SQL function's jsonb (numbers may arrive as strings). Null when it is not that shape. */
export function readCostFacts(value: unknown): CostFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.events)) return null
  return {
    events: arr(v.events).map((e) => ({
      project_id: String(e.project_id ?? ''),
      repo: String(e.repo ?? ''),
      workflow_name: String(e.workflow_name ?? ''),
      job_name: String(e.job_name ?? ''),
      event: String(e.event ?? ''),
      branch_kind: kindOf(e.branch_kind),
      runner_class: cls(e.runner_class),
      os: osOf(e.os),
      jobs: nnum(e.jobs),
      runs: nnum(e.runs),
      billed_minutes: nnum(e.billed_minutes),
    })),
    prs: arr(v.prs)
      .map((p) => ({
        project_id: String(p.project_id ?? ''),
        repo: String(p.repo ?? ''),
        pr_number: nnum(p.pr_number),
        workflow_name: String(p.workflow_name ?? ''),
        runner_class: cls(p.runner_class),
        os: osOf(p.os),
        jobs: nnum(p.jobs),
        billed_minutes: nnum(p.billed_minutes),
      }))
      .filter((p) => p.pr_number > 0),
    steps: arr(v.steps).map((s) => ({
      project_id: String(s.project_id ?? ''),
      repo: String(s.repo ?? ''),
      workflow_name: String(s.workflow_name ?? ''),
      job_name: String(s.job_name ?? ''),
      os: osOf(s.os),
      step_name: String(s.step_name ?? ''),
      runs: nnum(s.runs),
      seconds: nnum(s.seconds),
    })),
    jobs: nnum(v.jobs),
  }
}

const MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
const isMissing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && ((!!e.code && MISSING_CODES.has(e.code)) || /could not find the (function|table)|does not exist|schema cache/i.test(e.message ?? ''))

export interface LoadedCostFacts {
  facts: CostFacts | null
  source: 'sql' | 'rows' | 'none'
  /** Why the facts are partial or missing; null when complete. */
  note: string | null
}

/**
 * ci_cost_facts, else the newest MAX_FACT_JOBS jobs aggregated here. Never
 * throws: a failed read gives null facts and a note, so only the rules that
 * need them go quiet.
 */
export async function loadCostFacts(db: Db, projectIds: readonly string[], from: Date, to: Date): Promise<LoadedCostFacts> {
  if (projectIds.length === 0) return { facts: { events: [], prs: [], steps: [], jobs: 0 }, source: 'sql', note: null }
  try {
    const res = await db.rpc('ci_cost_facts', { project_ids: projectIds, p_from: from.toISOString(), p_to: to.toISOString() })
    if (!res.error) {
      const facts = readCostFacts(res.data)
      return facts ? { facts, source: 'sql', note: null } : { facts: null, source: 'none', note: 'The cost facts came back in a shape Mushi cannot read, so the job-based cost advice is left out.' }
    }
    if (!isMissing(res.error)) return { facts: null, source: 'none', note: 'The job totals for cost advice could not be read, so the job-based cost advice is left out this time.' }
    const read = await readAllPages<CostFactJobRow>(
      (lo, hi, count) =>
        db
          .from('ci_jobs')
          .select(COST_FACT_JOB_COLUMNS, { count })
          .in('project_id', projectIds)
          .gte('gh_created_at', from.toISOString())
          .lte('gh_created_at', to.toISOString())
          .order('gh_created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(lo, hi),
      { what: 'ci_jobs', maxRows: MAX_FACT_JOBS },
    )
    return {
      facts: aggregateCostFacts(read.rows, { from, to }),
      source: 'rows',
      note: read.truncated ? `Cost advice is based on the newest ${read.rows.length.toLocaleString('en-US')} jobs: the database update that totals the whole window is not applied yet.` : null,
    }
  } catch {
    return { facts: null, source: 'none', note: 'The job totals for cost advice could not be read, so the job-based cost advice is left out this time.' }
  }
}

/** USD at GitHub's list price for GitHub-hosted minutes on a repo that is not public; 0 otherwise. */
export function usdForMinutes(minutes: number, os: RunnerOs, runnerClass: CiRunnerKind, visibility: 'public' | 'private' | 'unknown'): number {
  if (runnerClass !== 'github_hosted' || visibility === 'public' || minutes <= 0) return 0
  return minutes * GITHUB_RUNNER_RATES.usdPerMinute[os]
}

/** A window's amount scaled to 30 days, rounded to cents. */
export function monthUsd(amount: number, spanDays: number): number {
  if (!(spanDays > 0)) return 0
  return Math.round(((amount * 30) / spanDays) * 100) / 100
}

/** Paid (private or unknown visibility, GitHub-hosted) billed minutes and those on agent branches. */
export function agentMinutes(facts: CostFacts, visibilityOf: (repo: string) => 'public' | 'private' | 'unknown'): { billedMinutes: number; agentBilledMinutes: number } {
  let billed = 0
  let agent = 0
  for (const e of facts.events) {
    if (e.runner_class !== 'github_hosted' || visibilityOf(e.repo) === 'public') continue
    billed += e.billed_minutes
    if (e.branch_kind === 'agent') agent += e.billed_minutes
  }
  return { billedMinutes: billed, agentBilledMinutes: agent }
}
