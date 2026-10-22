/**
 * FILE: packages/server/supabase/functions/_shared/ci-placement.ts
 * PURPOSE: Choosing where a repo's CI runs (Plan 022 Phase 7b, ADR 0037).
 *          Pure rules shared by the preview route, the request route and the
 *          GitHub connector's act() (which checks them again at execution):
 *
 *   allowlist   Mushi writes only LINUX_RUNNER and RUNNER_<WORKFLOW>; any
 *               other variable name is refused, whatever the token allows
 *   policy      the organization's CI agreement (ci_runner_policies): no
 *               paid GitHub-hosted minutes on private repos unless allowed,
 *               external controllers own their repos (Mushi only shows
 *               them), standby runners are never a target
 *   jobs        which jobs move with the variable, which stay and why
 *               (pinned to GitHub with the YAML reason, main / Dependabot
 *               guards, another variable, an expression)
 *   preview     current vs new value, the target label's runners, measured
 *               wait, cost change, the policy verdict, warnings, and the
 *               exact payload a request would store (with the variable's
 *               current value and updated_at for the compare-and-set)
 *
 * Pure: no I/O.
 */

import { isHostedLabel, runsOnJobMatches, type ParsedWorkflow } from './ci-runs-on.ts'
import { runnerBaseName } from './ci-infra.ts'

/** The only variables Mushi may write (ADR 0037). */
export const PLACEMENT_VARIABLE_RE = /^(?:LINUX_RUNNER|RUNNER_[A-Z0-9_]{1,60})$/
/** A runner label as GitHub accepts it in a variable value Mushi writes. */
export const RUNNER_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const PLACEMENT_ACTIONS = ['set_actions_variable', 'delete_actions_variable'] as const
export type PlacementAction = (typeof PLACEMENT_ACTIONS)[number]
/** A variable changed this recently, not by Mushi, gets a warning. */
export const RECENT_CHANGE_MS = 24 * 60 * 60_000
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export function isAllowedPlacementVariable(name: unknown): boolean {
  return typeof name === 'string' && PLACEMENT_VARIABLE_RE.test(name)
}

/** RUNNER_<WORKFLOW> for a workflow file name: `e2e.yml` → RUNNER_E2E. */
export function workflowVariableName(workflowPath: string): string {
  const base = workflowPath.split('/').pop()?.replace(/\.ya?ml$/i, '') ?? ''
  return `RUNNER_${base.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'WORKFLOW'}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────────────

export interface ExternalController {
  name: string
  owner: string
  repos: string[]
  note: string | null
}

export interface CiRunnerPolicy {
  organizationId: string
  noPaidHostedOnPrivate: boolean
  hostedAllowedRepos: string[]
  externalControllers: ExternalController[]
  standbyRunners: string[]
  sourceNote: string | null
  updatedAt: string | null
}

export interface PolicyRow {
  organization_id: string
  no_paid_hosted_on_private?: boolean | null
  hosted_allowed_repos?: string[] | null
  external_controllers?: unknown
  standby_runners?: string[] | null
  source_note?: string | null
  updated_at?: string | null
}

const strs = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))].slice(0, max) : []

export function normalizePolicy(row: PolicyRow | null): CiRunnerPolicy | null {
  if (!row) return null
  const controllers: ExternalController[] = []
  for (const c of Array.isArray(row.external_controllers) ? row.external_controllers.slice(0, 20) : []) {
    if (!c || typeof c !== 'object') continue
    const x = c as Record<string, unknown>
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 80) : ''
    const repos = strs(x.repos, 50).filter((r) => REPO_RE.test(r))
    if (!name || repos.length === 0) continue
    controllers.push({ name, owner: typeof x.owner === 'string' ? x.owner.trim().slice(0, 80) : '', repos, note: typeof x.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 200) : null })
  }
  return {
    organizationId: row.organization_id,
    noPaidHostedOnPrivate: row.no_paid_hosted_on_private === true,
    hostedAllowedRepos: strs(row.hosted_allowed_repos).filter((r) => REPO_RE.test(r)),
    externalControllers: controllers,
    standbyRunners: strs(row.standby_runners, 100),
    sourceNote: row.source_note ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

/** `*` matches any run of characters; case-insensitive. */
export function matchesPattern(value: string, pattern: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')
  return re.test(value)
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function externalControllerFor(policy: CiRunnerPolicy | null, repo: string): ExternalController | null {
  return policy?.externalControllers.find((c) => c.repos.some((r) => sameRepo(r, repo))) ?? null
}

export type PlacementTarget = { kind: 'github_hosted'; label: string | null } | { kind: 'self_hosted'; label: string }

/**
 * Where jobs that follow the variable would run with `value` (null = no
 * variable: they use the workflow's fallback label).
 */
export function targetOf(value: string | null, fallbackLabel: string | null): PlacementTarget {
  if (value === null || value.trim() === '') {
    if (fallbackLabel && !isHostedLabel(fallbackLabel)) return { kind: 'self_hosted', label: fallbackLabel }
    return { kind: 'github_hosted', label: fallbackLabel }
  }
  return isHostedLabel(value) ? { kind: 'github_hosted', label: value } : { kind: 'self_hosted', label: value }
}

export type PolicyCode = 'EXTERNAL_CONTROLLER' | 'POLICY_NO_PAID_HOSTED' | 'POLICY_STANDBY_TARGET'

export interface PolicyVerdict {
  allowed: boolean
  code: PolicyCode | null
  reason: string | null
  /** The controller that owns this repo, shown read-only. */
  controller: ExternalController | null
}

export interface RunnerSeen {
  runner_name: string
  status: string
  busy?: boolean | null
  labels: string[] | null
}

/** Runners (one-job runners folded) that carry `label`. */
export function runnersWithLabel(runners: readonly RunnerSeen[], label: string): RunnerSeen[] {
  const out = new Map<string, RunnerSeen>()
  for (const r of runners) {
    if (!(r.labels ?? []).some((l) => l.toLowerCase() === label.toLowerCase())) continue
    const base = runnerBaseName(r.runner_name)
    const prev = out.get(base)
    out.set(base, { ...r, runner_name: base, status: prev?.status === 'online' ? 'online' : r.status, busy: (prev?.busy ?? false) || (r.busy ?? false) })
  }
  return [...out.values()]
}

export function policyVerdict(
  policy: CiRunnerPolicy | null,
  input: { repo: string; visibility: 'public' | 'private' | 'unknown'; target: PlacementTarget; runners: readonly RunnerSeen[] },
): PolicyVerdict {
  const controller = externalControllerFor(policy, input.repo)
  const allow: PolicyVerdict = { allowed: true, code: null, reason: null, controller }
  if (!policy) return allow
  if (controller) {
    return {
      allowed: false,
      code: 'EXTERNAL_CONTROLLER',
      reason: `${input.repo} is managed by ${controller.name}${controller.owner ? ` (${controller.owner})` : ''}. Mushi shows it and does not change it.`,
      controller,
    }
  }
  if (input.target.kind === 'github_hosted' && policy.noPaidHostedOnPrivate && input.visibility !== 'public' && !policy.hostedAllowedRepos.some((r) => sameRepo(r, input.repo))) {
    return {
      allowed: false,
      code: 'POLICY_NO_PAID_HOSTED',
      reason: `Your CI agreement says no paid GitHub-hosted minutes on private repos${input.visibility === 'unknown' ? ' (Mushi has not confirmed this repo is public, so it counts as private)' : ''}.${policy.sourceNote ? ` Source: ${policy.sourceNote}.` : ''}`,
      controller,
    }
  }
  if (input.target.kind === 'self_hosted') {
    const label = input.target.label
    const standby = (v: string) => policy.standbyRunners.some((p) => matchesPattern(v, p))
    const carriers = runnersWithLabel(input.runners, label)
    if (standby(label) || (carriers.length > 0 && carriers.every((r) => standby(r.runner_name)))) {
      return { allowed: false, code: 'POLICY_STANDBY_TARGET', reason: `“${label}” is a standby runner in your CI agreement: it is never a target.`, controller }
    }
  }
  return allow
}

// ─────────────────────────────────────────────────────────────────────────────
// Jobs
// ─────────────────────────────────────────────────────────────────────────────

export interface PlacementJob {
  workflow: string
  workflowPath: string
  job: string
}

export interface PlacementJobs {
  /** Jobs that follow this variable: they move (their main / Dependabot runs may not). */
  moves: Array<PlacementJob & { fallback: string | null; mainStays: boolean; dependabotStays: boolean }>
  stays: Array<PlacementJob & { why: 'pinned_hosted' | 'pinned_self_hosted' | 'other_variable' | 'expression'; detail: string }>
}

export function classifyPlacementJobs(parsed: readonly ParsedWorkflow[], variable: string): PlacementJobs {
  const out: PlacementJobs = { moves: [], stays: [] }
  for (const wf of parsed) {
    for (const j of wf.jobs) {
      const base = { workflow: wf.name ?? wf.path, workflowPath: wf.path, job: j.jobName ?? j.jobId }
      if (j.kind === 'follows_variable' && j.variables.includes(variable)) {
        out.moves.push({ ...base, fallback: j.fallbackLabel, mainStays: j.hostedOnMain, dependabotStays: j.hostedForDependabot })
      } else if (j.kind === 'pinned_hosted') {
        out.stays.push({ ...base, why: 'pinned_hosted', detail: j.pinnedReason ? `Pinned to GitHub: ${j.pinnedReason}` : 'Pinned to GitHub in the workflow (no reason given).' })
      } else if (j.kind === 'pinned_self_hosted') {
        out.stays.push({ ...base, why: 'pinned_self_hosted', detail: `Always runs on ${j.labels.join(', ')}${j.pinnedReason ? `: ${j.pinnedReason}` : ''}.` })
      } else if (j.kind === 'follows_variable') {
        out.stays.push({ ...base, why: 'other_variable', detail: `Reads ${j.variables.map((v) => `vars.${v}`).join(', ')}, not vars.${variable}.` })
      } else {
        out.stays.push({ ...base, why: 'expression', detail: `runs-on is ${j.runsOn}; Mushi cannot tell where that runs.` })
      }
    }
  }
  return out
}

/** The fallback label most moving jobs use (where they run with no variable). */
export function dominantFallback(moves: PlacementJobs['moves']): string | null {
  const counts = new Map<string, number>()
  for (const m of moves) if (m.fallback) counts.set(m.fallback, (counts.get(m.fallback) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload and preview
// ─────────────────────────────────────────────────────────────────────────────

export interface VariableState {
  exists: boolean
  value: string | null
  updatedAt: string | null
}

export interface PlacementPayload {
  repo: string
  name: string
  /** The new value; null for delete. */
  value: string | null
  /** What the variable was when the person previewed it: execution refuses if it moved. */
  expected: VariableState
  /** Jobs the change moves, for the post-change watch. */
  jobs: Array<{ workflow: string; job: string }>
  /** Where those jobs should land. */
  expectedLabels: string[]
}

export function actionFor(value: string | null): PlacementAction {
  return value === null ? 'delete_actions_variable' : 'set_actions_variable'
}

/** Validate a payload as act() receives it. Null = valid; else why not. */
export function payloadProblem(p: unknown, action: string): string | null {
  if (!p || typeof p !== 'object') return 'The payload is not an object.'
  const x = p as Record<string, unknown>
  if (!(PLACEMENT_ACTIONS as readonly string[]).includes(action)) return `Unknown action ${action}.`
  if (typeof x.repo !== 'string' || !REPO_RE.test(x.repo)) return 'The payload has no owner/repo.'
  if (!isAllowedPlacementVariable(x.name)) return `Mushi only changes LINUX_RUNNER and RUNNER_<WORKFLOW> variables, not "${String(x.name).slice(0, 60)}".`
  if (action === 'set_actions_variable' && (typeof x.value !== 'string' || !RUNNER_LABEL_RE.test(x.value))) return 'The new value must be one runner label.'
  if (action === 'delete_actions_variable' && x.value !== null) return 'A delete carries no value.'
  const e = x.expected as Record<string, unknown> | null | undefined
  if (!e || typeof e !== 'object' || typeof e.exists !== 'boolean') return 'The payload has no expected current state (compare-and-set).'
  if (e.exists && typeof e.value !== 'string') return 'The expected current value is missing.'
  return null
}

/** True when the variable as read now is the one the person saw. */
export function variableMatches(expected: VariableState, current: VariableState): boolean {
  if (expected.exists !== current.exists) return false
  if (!expected.exists) return true
  return expected.value === current.value && (expected.updatedAt ?? null) === (current.updatedAt ?? null)
}

export interface PlacementPreview {
  repo: string
  projectId: string
  visibility: 'public' | 'private' | 'unknown'
  variable: string
  action: PlacementAction
  current: VariableState | null
  next: { value: string | null; target: PlacementTarget }
  now: { target: PlacementTarget }
  jobs: PlacementJobs
  target: { label: string | null; runners: number; online: number; busy: number; waitP95s: number | null } | null
  cost: { monthCostDelta: number; currency: string; note: string } | null
  policy: PolicyVerdict
  warnings: string[]
  /** Null when the change cannot be requested (see `blocked`). */
  payload: PlacementPayload | null
  blocked: { code: string; message: string } | null
}

export interface PreviewInput {
  projectId: string
  repo: string
  visibility: 'public' | 'private' | 'unknown'
  variable: string
  /** The new value; null removes the variable (jobs use their fallback). */
  value: string | null
  /** Null when the token cannot read the variable. */
  current: VariableState | null
  /** Null when Mushi has not read the repo's workflows. */
  parsed: readonly ParsedWorkflow[] | null
  policy: CiRunnerPolicy | null
  runners: readonly RunnerSeen[]
  /** Measured wait p95 per label (from the cost comparison). */
  waitP95ByLabel: Record<string, number | null>
  cost: PlacementPreview['cost']
  now: Date
}

function ago(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h < 1 ? 'less than an hour ago' : h === 1 ? 'an hour ago' : `${h} hours ago`
}

export function buildPlacementPreview(input: PreviewInput): PlacementPreview {
  const warnings: string[] = []
  const jobs = input.parsed ? classifyPlacementJobs(input.parsed, input.variable) : { moves: [], stays: [] }
  const fallback = dominantFallback(jobs.moves)
  const nextTarget = targetOf(input.value, fallback)
  const nowTarget = targetOf(input.current?.exists ? input.current.value : null, fallback)
  const policy = policyVerdict(input.policy, { repo: input.repo, visibility: input.visibility, target: nextTarget, runners: input.runners })
  const action = actionFor(input.value)
  const block = (code: string, message: string) => ({ code, message })
  let blocked: PlacementPreview['blocked'] = null

  if (!isAllowedPlacementVariable(input.variable)) blocked = block('VARIABLE_NOT_ALLOWED', `Mushi only changes LINUX_RUNNER and RUNNER_<WORKFLOW> variables, not "${String(input.variable).slice(0, 60)}".`)
  else if (input.value !== null && !RUNNER_LABEL_RE.test(input.value)) blocked = block('VALIDATION_ERROR', 'Pick one runner label (letters, digits, dot, dash, underscore).')
  else if (!input.current) blocked = block('VARIABLE_UNREADABLE', 'Mushi could not read the variable, so it cannot check that nobody changed it in between. Give the stored GitHub token Variables: read (fine-grained) or repo (classic).')
  else if (!policy.allowed) blocked = block(policy.code ?? 'POLICY_REFUSED', policy.reason ?? 'Your CI agreement refuses this change.')
  else if ((input.current.exists ? input.current.value : null) === input.value) blocked = block('NO_CHANGE', 'The variable already has this value.')
  else if (input.value === null && !input.current.exists) blocked = block('NO_CHANGE', 'The variable is not set.')

  let target: PlacementPreview['target'] = null
  if (nextTarget.kind === 'self_hosted') {
    const carriers = runnersWithLabel(input.runners, nextTarget.label)
    target = {
      label: nextTarget.label,
      runners: carriers.length,
      online: carriers.filter((r) => r.status === 'online').length,
      busy: carriers.filter((r) => r.busy).length,
      waitP95s: input.waitP95ByLabel[nextTarget.label] ?? null,
    }
    if (carriers.length === 0) warnings.push(`No runner Mushi has seen carries the label “${nextTarget.label}”. Jobs would wait, then GitHub cancels them after 24 hours.`)
    else if (target.online === 0) warnings.push(`No runner with the label “${nextTarget.label}” is online right now. Jobs would wait, then expire after 24 hours.`)
    if (input.visibility === 'public') warnings.push(`${input.repo} is public: a pull request from a fork could run code on that machine. Require approval for outside contributors (Settings → Actions → General) first.`)
  } else {
    target = { label: nextTarget.label, runners: 0, online: 0, busy: 0, waitP95s: nextTarget.label ? input.waitP95ByLabel[nextTarget.label] ?? null : null }
    if (input.visibility !== 'public') warnings.push(`${input.repo} is ${input.visibility === 'private' ? 'private' : 'not confirmed public'}: GitHub-hosted minutes are billed after the plan's included minutes.`)
  }

  if (!input.parsed) warnings.push('Mushi has not read this repo\'s workflow files yet, so it cannot list the jobs that move.')
  else if (jobs.moves.length === 0) warnings.push(`No job in this repo's workflows reads vars.${input.variable}, so nothing would move.`)
  if (jobs.moves.some((m) => m.mainStays || m.dependabotStays)) warnings.push('Runs on main and Dependabot updates keep using GitHub: the workflows check github.ref / github.actor first.')
  if (input.current?.exists && input.current.updatedAt) {
    const age = input.now.getTime() - Date.parse(input.current.updatedAt)
    if (Number.isFinite(age) && age >= 0 && age < RECENT_CHANGE_MS) warnings.push(`This variable last changed ${ago(age)}. If another tool manages it, the two will fight.`)
  }
  if (jobs.moves.length > 0) warnings.push('Jobs already queued keep the runner they asked for; the change applies to new runs.')

  const expectedLabels = nextTarget.label ? [nextTarget.label] : []
  const payload: PlacementPayload | null =
    blocked || !input.current
      ? null
      : {
          repo: input.repo,
          name: input.variable,
          value: input.value,
          expected: { exists: input.current.exists, value: input.current.exists ? input.current.value : null, updatedAt: input.current.exists ? input.current.updatedAt : null },
          jobs: jobs.moves.map((m) => ({ workflow: m.workflow, job: m.job })).slice(0, 50),
          expectedLabels,
        }

  return {
    repo: input.repo,
    projectId: input.projectId,
    visibility: input.visibility,
    variable: input.variable,
    action,
    current: input.current,
    next: { value: input.value, target: nextTarget },
    now: { target: nowTarget },
    jobs,
    target,
    cost: input.cost,
    policy,
    warnings,
    payload,
    blocked,
  }
}

/** The revert of an executed change: the previous value back (or delete), with the variable as Mushi left it as the expected state. */
export function revertPayload(done: PlacementPayload, left: VariableState): PlacementPayload {
  return {
    repo: done.repo,
    name: done.name,
    value: done.expected.exists ? done.expected.value : null,
    expected: left,
    jobs: done.jobs,
    expectedLabels: done.expected.exists && done.expected.value ? [done.expected.value] : [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-change watch
// ─────────────────────────────────────────────────────────────────────────────

export const WATCH_JOBS = 10
/** A moved job waiting longer than this raises an alert. */
export const WATCH_SLOW_QUEUE_S = 30 * 60
/** A watch with no matching job after this long expires. */
export const WATCH_MAX_MS = 7 * 24 * 60 * 60_000

export interface WatchState {
  jobs: Array<{ workflow: string; job: string }>
  expectedLabels: string[]
  startedAt: string
}

export interface WatchJob {
  workflow_name: string | null
  job_name: string
  runner_labels: string[] | null
  queue_seconds: number | null
  gh_created_at: string
  head_branch: string | null
  html_url: string | null
}

export interface WatchResult {
  status: 'watching' | 'ok' | 'alert' | 'expired'
  jobsSeen: number
  unexpected: Array<{ job: string; labels: string[]; url: string | null }>
  slow: Array<{ job: string; queueSeconds: number; url: string | null }>
}

/**
 * The next WATCH_JOBS jobs after the change that read the variable (main and
 * Dependabot runs left out: they never move): did they ask for the expected
 * label, and did they start within 30 minutes?
 */
export function evaluateWatch(watch: WatchState, jobs: readonly WatchJob[], now: Date): WatchResult {
  const since = Date.parse(watch.startedAt)
  const matchers = watch.jobs.map((j) => ({
    kind: 'follows_variable' as const,
    workflowPath: j.workflow,
    workflowName: j.workflow,
    jobId: j.job,
    jobName: j.job,
    runsOn: '',
    variables: [],
    fallbackLabel: null,
    labels: [],
    pinnedReason: null,
    hostedOnMain: false,
    hostedForDependabot: false,
    pullRequestOnly: false,
  }))
  const relevant = jobs
    .filter((j) => Date.parse(j.gh_created_at) >= since)
    .filter((j) => !['main', 'master'].includes(j.head_branch ?? '') && !(j.head_branch ?? '').startsWith('dependabot/'))
    .filter((j) => matchers.some((m) => runsOnJobMatches(m, j.workflow_name, j.job_name)))
    .sort((a, b) => a.gh_created_at.localeCompare(b.gh_created_at))
    .slice(0, WATCH_JOBS)
  const want = watch.expectedLabels.map((l) => l.toLowerCase())
  const unexpected = want.length === 0
    ? []
    : relevant.filter((j) => !(j.runner_labels ?? []).some((l) => want.includes(l.toLowerCase()))).map((j) => ({ job: j.job_name, labels: j.runner_labels ?? [], url: j.html_url }))
  const slow = relevant
    .filter((j) => (j.queue_seconds ?? 0) > WATCH_SLOW_QUEUE_S)
    .map((j) => ({ job: j.job_name, queueSeconds: j.queue_seconds as number, url: j.html_url }))
  const status: WatchResult['status'] =
    unexpected.length > 0 || slow.length > 0
      ? 'alert'
      : relevant.length >= WATCH_JOBS
        ? 'ok'
        : now.getTime() - since > WATCH_MAX_MS
          ? 'expired'
          : 'watching'
  return { status, jobsSeen: relevant.length, unexpected, slow }
}
