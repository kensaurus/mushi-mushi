/**
 * FILE: packages/server/supabase/functions/_shared/ci-placement.ts
 * PURPOSE: Choosing where a repo's CI runs (Plan 022 Phase 7b, ADR 0037).
 *          Pure rules shared by the preview route, the request route and the
 *          GitHub connector's act() (which checks them again at execution):
 *
 *   allowlist   Mushi writes only LINUX_RUNNER, RUNNER_<WORKFLOW> and
 *               CI_PROFILE (economy | thorough, offered only where a
 *               workflow reads vars.CI_PROFILE); any other variable name is
 *               refused, whatever the token allows
 *   time-box    a move to GitHub-hosted runners may carry revertAfterHours
 *               (approved with the change); the CI collector switches it
 *               back when due, with the same compare-and-set
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

import { isHostedLabel, runsOnJobMatches, workflowsRead, type ParsedWorkflow } from './ci-runs-on.ts'
import { runnerBaseName } from './ci-infra.ts'

/** The only variables Mushi may write (ADR 0037). */
export const PLACEMENT_VARIABLE_RE = /^(?:LINUX_RUNNER|RUNNER_[A-Z0-9_]{1,60})$/
/** A runner label as GitHub accepts it in a variable value Mushi writes. */
export const RUNNER_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const PLACEMENT_ACTIONS = ['set_actions_variable', 'delete_actions_variable'] as const
export type PlacementAction = (typeof PLACEMENT_ACTIONS)[number]
/** A variable changed this recently, not by Mushi, gets a warning. */
export const RECENT_CHANGE_MS = 24 * 60 * 60_000
/** owner/repo; `.` and `..` are never a segment (they would rewrite the API path). */
export const REPO_RE = /^(?!\.\.?\/)[A-Za-z0-9._-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/

/**
 * How much of a repo's CI runs on fix pull requests: `economy` (the default,
 * also when unset) lets workflows skip the slow, billed checks on Mushi fix
 * heads, which still run on the release train and on main; `thorough` runs
 * everything on every pull request. Only a workflow that reads
 * vars.CI_PROFILE changes with it.
 */
export const PROFILE_VARIABLE = 'CI_PROFILE'
export const PROFILE_VALUES = ['economy', 'thorough'] as const
/** The longest a move to GitHub-hosted runners may last before it switches back on its own. */
export const MAX_REVERT_AFTER_HOURS = 168
const ALLOWED_NAMES = 'LINUX_RUNNER, RUNNER_<WORKFLOW> and CI_PROFILE'

export function isAllowedPlacementVariable(name: unknown): boolean {
  return typeof name === 'string' && (PLACEMENT_VARIABLE_RE.test(name) || name === PROFILE_VARIABLE)
}

export function isProfileVariable(name: unknown): boolean {
  return name === PROFILE_VARIABLE
}

function isProfileValue(v: unknown): boolean {
  return typeof v === 'string' && (PROFILE_VALUES as readonly string[]).includes(v)
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

/**
 * `*` matches any run of characters; case-insensitive. A linear two-pointer
 * glob, not a RegExp: an owner-written pattern like `*a*a*a*c` must not
 * backtrack.
 */
export function matchesPattern(value: string, pattern: string): boolean {
  const v = value.toLowerCase()
  const p = pattern.toLowerCase().replace(/\*+/g, '*')
  let vi = 0
  let pi = 0
  let star = -1
  let mark = 0
  while (vi < v.length) {
    if (pi < p.length && p[pi] !== '*' && p[pi] === v[vi]) {
      vi++
      pi++
    } else if (pi < p.length && p[pi] === '*') {
      star = pi++
      mark = vi
    } else if (star >= 0) {
      pi = star + 1
      vi = ++mark
    } else {
      return false
    }
  }
  while (pi < p.length && p[pi] === '*') pi++
  return pi === p.length
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

export type PolicyCode = 'EXTERNAL_CONTROLLER' | 'POLICY_NO_PAID_HOSTED' | 'POLICY_STANDBY_TARGET' | 'POLICY_UNKNOWN_TARGET'

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
  /** ci_runners.kind; a GitHub-hosted (larger) runner never proves a label is yours. */
  kind?: string | null
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
    const carriers = runnersWithLabel(input.runners, label).filter((r) => r.kind !== 'github_hosted')
    if (standby(label) || (carriers.length > 0 && carriers.every((r) => standby(r.runner_name)))) {
      return { allowed: false, code: 'POLICY_STANDBY_TARGET', reason: `“${label}” is a standby runner in your CI agreement: it is never a target.`, controller }
    }
    // A label no self-hosted runner of this repo carries could be a paid GitHub larger runner.
    if (carriers.length === 0 && policy.noPaidHostedOnPrivate && input.visibility !== 'public' && !policy.hostedAllowedRepos.some((r) => sameRepo(r, input.repo))) {
      return {
        allowed: false,
        code: 'POLICY_UNKNOWN_TARGET',
        reason: `No self-hosted runner of ${input.repo} carries “${label}”, so it could be a paid GitHub larger runner. Pick a label one of your runners has.`,
        controller,
      }
    }
  }
  return allow
}

/** Every place jobs could land: the new value, or with no variable each fallback the moving jobs use. */
export function targetsOf(value: string | null, fallbacks: readonly string[]): PlacementTarget[] {
  if (value !== null && value.trim() !== '') return [targetOf(value, null)]
  const distinct = [...new Set(fallbacks.filter(Boolean))]
  return distinct.length > 0 ? distinct.map((f) => targetOf(null, f)) : [targetOf(null, null)]
}

/** The policy for every target: the first refusal wins. */
export function policyVerdictAll(
  policy: CiRunnerPolicy | null,
  input: { repo: string; visibility: 'public' | 'private' | 'unknown'; targets: readonly PlacementTarget[]; runners: readonly RunnerSeen[] },
): PolicyVerdict {
  let first: PolicyVerdict | null = null
  for (const target of input.targets) {
    const v = policyVerdict(policy, { repo: input.repo, visibility: input.visibility, target, runners: input.runners })
    first ??= v
    if (!v.allowed) return v
  }
  return first ?? policyVerdict(policy, { repo: input.repo, visibility: input.visibility, target: targetOf(null, null), runners: input.runners })
}

/**
 * The verdict for one change, as preview and act() both decide it. CI_PROFILE
 * moves no job, so only the external-controller rule applies to it; a runner
 * variable is checked against every target its jobs would land on.
 */
export function placementVerdict(
  policy: CiRunnerPolicy | null,
  input: { repo: string; visibility: 'public' | 'private' | 'unknown'; name: string; value: string | null; fallbacks: readonly string[]; runners: readonly RunnerSeen[] },
): PolicyVerdict {
  if (!isProfileVariable(input.name)) {
    return policyVerdictAll(policy, { repo: input.repo, visibility: input.visibility, targets: targetsOf(input.value, input.fallbacks), runners: input.runners })
  }
  const controller = externalControllerFor(policy, input.repo)
  if (policy && controller) {
    return {
      allowed: false,
      code: 'EXTERNAL_CONTROLLER',
      reason: `${input.repo} is managed by ${controller.name}${controller.owner ? ` (${controller.owner})` : ''}. Mushi shows it and does not change it.`,
      controller,
    }
  }
  return { allowed: true, code: null, reason: null, controller }
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
  /** Every fallback label the moving jobs use (a delete sends each job to its own). */
  fallbackLabels?: string[]
  /** A move to GitHub-hosted switches back to `expected` after this many hours (approved with the change). */
  revertAfterHours?: number
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
  if (!isAllowedPlacementVariable(x.name)) return `Mushi only changes ${ALLOWED_NAMES} variables, not "${String(x.name).slice(0, 60)}".`
  if (action === 'set_actions_variable' && isProfileVariable(x.name) && !isProfileValue(x.value)) return 'CI_PROFILE is economy or thorough.'
  if (action === 'set_actions_variable' && !isProfileVariable(x.name) && (typeof x.value !== 'string' || !RUNNER_LABEL_RE.test(x.value))) return 'The new value must be one runner label.'
  if (action === 'delete_actions_variable' && x.value !== null) return 'A delete carries no value.'
  const e = x.expected as Record<string, unknown> | null | undefined
  if (!e || typeof e !== 'object' || typeof e.exists !== 'boolean') return 'The payload has no expected current state (compare-and-set).'
  if (e.exists && typeof e.value !== 'string') return 'The expected current value is missing.'
  if (x.fallbackLabels !== undefined && (!Array.isArray(x.fallbackLabels) || x.fallbackLabels.some((l) => typeof l !== 'string' || !RUNNER_LABEL_RE.test(l)))) return 'The fallback labels are not runner labels.'
  if (x.revertAfterHours !== undefined) {
    const h = x.revertAfterHours
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 1 || h > MAX_REVERT_AFTER_HOURS) return `revertAfterHours is a whole number from 1 to ${MAX_REVERT_AFTER_HOURS}.`
    const toHosted = action === 'set_actions_variable'
      ? typeof x.value === 'string' && isHostedLabel(x.value)
      : e.exists === true && (!Array.isArray(x.fallbackLabels) || (x.fallbackLabels as unknown[]).every((l) => typeof l === 'string' && isHostedLabel(l)))
    if (isProfileVariable(x.name) || !toHosted) return 'Only a move to GitHub-hosted runners switches back on its own.'
  }
  return null
}

/** When a time-boxed change is due to switch back, or null when it has no time-box. */
export function revertDueAt(payload: Pick<PlacementPayload, 'revertAfterHours'>, executedAt: string | null): Date | null {
  const h = payload.revertAfterHours
  if (!h || !executedAt) return null
  const t = Date.parse(executedAt)
  return Number.isFinite(t) ? new Date(t + h * 3_600_000) : null
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
  /** A move to GitHub-hosted switches back after this many hours. */
  revertAfterHours?: number | null
}

function ago(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h < 1 ? 'less than an hour ago' : h === 1 ? 'an hour ago' : `${h} hours ago`
}

export function buildPlacementPreview(input: PreviewInput): PlacementPreview {
  if (isProfileVariable(input.variable)) return buildProfilePreview(input)
  const warnings: string[] = []
  const jobs = input.parsed ? classifyPlacementJobs(input.parsed, input.variable) : { moves: [], stays: [] }
  const fallback = dominantFallback(jobs.moves)
  const fallbacks = [...new Set(jobs.moves.map((m) => m.fallback).filter((f): f is string => !!f))]
  const nextTarget = targetOf(input.value, fallback)
  const nowTarget = targetOf(input.current?.exists ? input.current.value : null, fallback)
  const policy = placementVerdict(input.policy, { repo: input.repo, visibility: input.visibility, name: input.variable, value: input.value, fallbacks, runners: input.runners })
  const action = actionFor(input.value)
  const block = (code: string, message: string) => ({ code, message })
  let blocked: PlacementPreview['blocked'] = null
  const revertAfterHours = input.revertAfterHours ?? null

  if (!isAllowedPlacementVariable(input.variable)) blocked = block('VARIABLE_NOT_ALLOWED', `Mushi only changes ${ALLOWED_NAMES} variables, not "${String(input.variable).slice(0, 60)}".`)
  else if (input.value !== null && !RUNNER_LABEL_RE.test(input.value)) blocked = block('VALIDATION_ERROR', 'Pick one runner label (letters, digits, dot, dash, underscore).')
  else if (revertAfterHours !== null && (!Number.isInteger(revertAfterHours) || revertAfterHours < 1 || revertAfterHours > MAX_REVERT_AFTER_HOURS)) blocked = block('VALIDATION_ERROR', `Switch back after 1 to ${MAX_REVERT_AFTER_HOURS} hours.`)
  else if (revertAfterHours !== null && nextTarget.kind !== 'github_hosted') blocked = block('VALIDATION_ERROR', 'Only a move to GitHub-hosted runners switches back on its own.')
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
  if (nextTarget.kind === 'github_hosted' && nowTarget.kind !== 'github_hosted') {
    const back = input.current?.exists ? `“${input.current.value}”` : 'its fallback'
    warnings.push(
      revertAfterHours !== null
        ? `Switches back to ${back} ${revertAfterHours} hour${revertAfterHours === 1 ? '' : 's'} after it runs, unless someone changes the variable first.`
        : 'No time limit: it stays on GitHub-hosted runners until someone switches it back.',
    )
  }

  const expectedLabels = input.value !== null ? [input.value] : fallbacks.length > 0 ? fallbacks : nextTarget.label ? [nextTarget.label] : []
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
          fallbackLabels: fallbacks.slice(0, 20),
          ...(revertAfterHours !== null ? { revertAfterHours } : {}),
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

/** CI_PROFILE: no job moves and no runner is targeted; the workflows must read it. */
function buildProfilePreview(input: PreviewInput): PlacementPreview {
  const warnings: string[] = []
  const block = (code: string, message: string) => ({ code, message })
  const policy = placementVerdict(input.policy, { repo: input.repo, visibility: input.visibility, name: input.variable, value: input.value, fallbacks: [], runners: input.runners })
  const reads = input.parsed ? workflowsRead(input.parsed, PROFILE_VARIABLE) : false
  const was = input.current?.exists ? input.current.value : null
  let blocked: PlacementPreview['blocked'] = null
  if (input.value !== null && !isProfileValue(input.value)) blocked = block('VALIDATION_ERROR', 'CI_PROFILE is economy or thorough.')
  else if (input.revertAfterHours != null) blocked = block('VALIDATION_ERROR', 'Only a move to GitHub-hosted runners switches back on its own.')
  else if (!input.parsed) blocked = block('WORKFLOWS_UNREAD', "Mushi has not read this repo's workflow files yet, so it cannot tell whether CI_PROFILE does anything here.")
  else if (!reads) blocked = block('PROFILE_NOT_READ', `No workflow in ${input.repo} reads vars.CI_PROFILE, so changing it would do nothing. Its workflows need an economy/thorough switch first.`)
  else if (!input.current) blocked = block('VARIABLE_UNREADABLE', 'Mushi could not read the variable, so it cannot check that nobody changed it in between. Give the stored GitHub token Variables: read (fine-grained) or repo (classic).')
  else if (!policy.allowed) blocked = block(policy.code ?? 'POLICY_REFUSED', policy.reason ?? 'Your CI agreement refuses this change.')
  else if (was === input.value) blocked = block('NO_CHANGE', 'The variable already has this value.')
  else if (input.value === null && !input.current.exists) blocked = block('NO_CHANGE', 'The variable is not set.')
  if ((input.value ?? 'economy') === 'thorough') {
    warnings.push(`Thorough runs every check on every pull request, Mushi fix pull requests included. On ${input.visibility === 'public' ? 'a public repo that is free on standard runners' : 'a private repo that means more billed GitHub-hosted minutes'}.`)
  } else {
    warnings.push('Economy (the default) lets fix pull requests skip the checks their workflows mark as skippable; those still run on the release train and on main before a deploy.')
  }
  // No runner is targeted: the console shows a profile row, not a target.
  const none: PlacementTarget = { kind: 'github_hosted', label: null }
  const payload: PlacementPayload | null =
    blocked || !input.current
      ? null
      : {
          repo: input.repo,
          name: input.variable,
          value: input.value,
          expected: { exists: input.current.exists, value: was, updatedAt: input.current.exists ? input.current.updatedAt : null },
          jobs: [],
          expectedLabels: [],
          fallbackLabels: [],
        }
  return {
    repo: input.repo,
    projectId: input.projectId,
    visibility: input.visibility,
    variable: input.variable,
    action: actionFor(input.value),
    current: input.current,
    next: { value: input.value, target: none },
    now: { target: none },
    jobs: { moves: [], stays: [] },
    target: null,
    cost: null,
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
    expectedLabels: done.expected.exists && done.expected.value ? [done.expected.value] : (done.fallbackLabels ?? []),
    fallbackLabels: done.fallbackLabels ?? [],
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
