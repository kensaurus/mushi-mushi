/**
 * FILE: packages/server/supabase/functions/_shared/recipe-drift.ts
 * PURPOSE: Pure drift rules for the App Recipe's Phase 2 elements (Plan 019
 *          §1.1 schema, §1.4 gates, §1.5 CI/CD, §1.6 deploy, §1.7 env,
 *          §1.8 integrations). Inputs are rows and file texts the collector
 *          already read; outputs are findings for `gate_findings`.
 *
 * Rules:
 *   - No I/O, no env reads. The collector does the reading.
 *   - Names only for env: a value never enters or leaves this module.
 *   - A file that cannot be read becomes a finding (`workflow_unreadable`),
 *     never silence; a target with no observation is returned as
 *     `unobserved` so the caller renders `unknown`, never `ok`.
 *   - Suggested fixes are patches, commands or prompts for the developer's
 *     editor. Mushi never runs them.
 */

import { parse as parseYaml } from 'npm:yaml@2'

export type DriftGate = 'ci_drift' | 'deploy_drift' | 'env_drift' | 'schema_drift' | 'code_health'
export type DriftSeverity = 'info' | 'warn' | 'error'

export interface DriftFinding {
  gate: DriftGate
  ruleId: string
  severity: DriftSeverity
  message: string
  filePath?: string
  suggestedFix: { kind: 'patch' | 'command' | 'prompt'; text: string }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── CI workflows ─────────────────────────────────────────────────────────────

/** Trigger names of a workflow's `on:` (string, list or map). YAML 1.1 `on` → true is handled too. */
function triggersOf(wf: Obj): { names: string[]; schedule: string[] } {
  const on = 'on' in wf ? wf.on : (wf as Record<string, unknown>)['true']
  const schedule: string[] = []
  if (typeof on === 'string') return { names: [on], schedule }
  if (Array.isArray(on)) return { names: on.filter((x): x is string => typeof x === 'string'), schedule }
  if (isObj(on)) {
    const sched = on.schedule
    if (Array.isArray(sched)) {
      for (const s of sched) if (isObj(s) && typeof s.cron === 'string') schedule.push(s.cron)
    }
    return { names: Object.keys(on), schedule }
  }
  return { names: [], schedule }
}

/** Expand one cron field to its set of values. null when the field cannot be read. */
export function expandCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    const step = m[3] ? Number(m[3]) : 1
    if (step < 1) return null
    let start: number
    let end: number
    if (m[1] === '*') {
      start = min
      end = max
    } else {
      start = Number(m[1])
      end = m[2] ? Number(m[2]) : m[3] ? max : start
    }
    if (start < min || end > max || start > end) return null
    for (let v = start; v <= end; v += step) out.add(v)
  }
  return out
}

/**
 * How many times a 5-field cron fires per day (minute × hour). Day, month
 * and weekday fields only thin out days, so they never raise the per-day
 * count. null when the expression cannot be read.
 */
export function cronFiresPerDay(expr: string): number | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minutes = expandCronField(fields[0], 0, 59)
  const hours = expandCronField(fields[1], 0, 23)
  if (!minutes || !hours) return null
  return minutes.size * hours.size
}

function runsOnText(job: Obj): string {
  const r = job['runs-on']
  if (typeof r === 'string') return r
  if (Array.isArray(r)) return r.filter((x) => typeof x === 'string').join(' ')
  if (isObj(r)) return [r.group, ...(Array.isArray(r.labels) ? r.labels : [r.labels])].filter((x) => typeof x === 'string').join(' ')
  return ''
}

function jobUsesMacos(job: Obj): boolean {
  const runsOn = runsOnText(job).toLowerCase()
  if (/\bmacos/.test(runsOn)) return true
  // `runs-on: ${{ matrix.os }}` with a macOS entry in the matrix.
  if (runsOn.includes('matrix.')) {
    const matrix = isObj(job.strategy) && isObj((job.strategy as Obj).matrix) ? (job.strategy as Obj).matrix as Obj : null
    if (matrix) return JSON.stringify(matrix).toLowerCase().includes('macos')
  }
  return false
}

/**
 * Static CI rules over `.github/workflows/*.yml` texts (the owner's ci-cost
 * rules, generalised): `workflow_no_concurrency`, `workflow_no_timeout`,
 * `macos_unconditional`, `artifact_retention_gt_14`, `cron_more_than_daily`,
 * and `workflow_unreadable` for a file that does not parse.
 */
export function ciWorkflowDrift(files: Record<string, string>): DriftFinding[] {
  const out: DriftFinding[] = []
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    let wf: unknown
    try {
      wf = parseYaml(text)
    } catch {
      wf = undefined
    }
    if (!isObj(wf) || !isObj(wf.jobs)) {
      out.push({
        gate: 'ci_drift', ruleId: 'workflow_unreadable', severity: 'info', filePath: path,
        message: `${path} could not be read as a GitHub Actions workflow, so it was not checked.`,
        suggestedFix: { kind: 'prompt', text: `Check that ${path} is valid YAML with a top-level \`jobs:\` map (GitHub shows the parse error on the Actions tab).` },
      })
      continue
    }
    const jobs = Object.entries(wf.jobs as Obj).filter(([, j]) => isObj(j)) as Array<[string, Obj]>
    const { names, schedule } = triggersOf(wf)

    const onCode = names.some((n) => n === 'push' || n === 'pull_request' || n === 'pull_request_target')
    const allJobsHaveConcurrency = jobs.length > 0 && jobs.every(([, j]) => j.concurrency !== undefined)
    if (onCode && wf.concurrency === undefined && !allJobsHaveConcurrency) {
      out.push({
        gate: 'ci_drift', ruleId: 'workflow_no_concurrency', severity: 'warn', filePath: path,
        message: `${path} runs on every push or pull request but has no concurrency group, so older runs keep going (and billing) after a newer push.`,
        suggestedFix: { kind: 'patch', text: 'concurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: ${{ github.event_name == \'pull_request\' }}' },
      })
    }

    const noTimeout = jobs.filter(([, j]) => j['timeout-minutes'] === undefined && j.uses === undefined).map(([id]) => id)
    if (noTimeout.length > 0) {
      out.push({
        gate: 'ci_drift', ruleId: 'workflow_no_timeout', severity: 'warn', filePath: path,
        message: `${path}: ${noTimeout.length === 1 ? 'job' : 'jobs'} ${noTimeout.join(', ')} ${noTimeout.length === 1 ? 'has' : 'have'} no timeout. A stuck job runs for up to 6 hours.`,
        suggestedFix: { kind: 'patch', text: `Add \`timeout-minutes: 15\` (or a limit that fits) under ${noTimeout.map((id) => `jobs.${id}`).join(', ')}.` },
      })
    }

    const macos = jobs.filter(([, j]) => jobUsesMacos(j) && j.if === undefined).map(([id]) => id)
    if (macos.length > 0) {
      out.push({
        gate: 'ci_drift', ruleId: 'macos_unconditional', severity: 'warn', filePath: path,
        message: `${path}: macOS ${macos.length === 1 ? 'job' : 'jobs'} ${macos.join(', ')} ${macos.length === 1 ? 'runs' : 'run'} on every trigger. macOS minutes cost about 10 times Linux minutes.`,
        suggestedFix: { kind: 'patch', text: `Run ${macos.map((id) => `jobs.${id}`).join(', ')} only for a release, e.g. \`if: startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'\`.` },
      })
    }

    const longRetention: string[] = []
    for (const [id, job] of jobs) {
      const steps = Array.isArray(job.steps) ? job.steps : []
      for (const step of steps) {
        if (!isObj(step) || typeof step.uses !== 'string' || !step.uses.startsWith('actions/upload-artifact')) continue
        const days = isObj(step.with) ? (step.with as Obj)['retention-days'] : undefined
        if (typeof days === 'string' && days.includes('${{')) continue
        const n = typeof days === 'number' ? days : typeof days === 'string' ? Number(days) : NaN
        if (!Number.isFinite(n) || n > 14) longRetention.push(`${id}${typeof step.name === 'string' ? ` (${step.name})` : ''}`)
      }
    }
    if (longRetention.length > 0) {
      out.push({
        gate: 'ci_drift', ruleId: 'artifact_retention_gt_14', severity: 'warn', filePath: path,
        message: `${path}: uploaded artifacts in ${longRetention.join(', ')} are kept longer than 14 days (90 by default), and storage is billed.`,
        suggestedFix: { kind: 'patch', text: 'Under each actions/upload-artifact step add:\nwith:\n  retention-days: 7' },
      })
    }

    const busy = schedule.filter((c) => (cronFiresPerDay(c) ?? 0) > 1)
    if (busy.length > 0) {
      out.push({
        gate: 'ci_drift', ruleId: 'cron_more_than_daily', severity: 'warn', filePath: path,
        message: `${path}: the schedule ${busy.map((c) => `"${c}"`).join(', ')} runs more than once a day.`,
        suggestedFix: { kind: 'patch', text: 'Run scheduled checks at most once a day, e.g. `- cron: \'17 3 * * *\'`, or weekly for advisory checks.' },
      })
    }
  }
  return out
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])

/** `default_branch_red`: the last `n` completed runs on the default branch all failed. */
export function defaultBranchRed(
  runs: ReadonlyArray<{ head_branch: string | null; conclusion: string | null; completed_at: string | null }>,
  defaultBranch: string,
  n = 3,
): DriftFinding[] {
  const recent = runs
    .filter((r) => r.head_branch === defaultBranch && r.conclusion && r.completed_at)
    .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))
    .slice(0, n)
  if (recent.length < n || !recent.every((r) => FAILED.has(r.conclusion!))) return []
  return [{
    gate: 'ci_drift', ruleId: 'default_branch_red', severity: 'error',
    message: `The last ${n} CI runs on ${defaultBranch} failed, so merged fixes are not being built or deployed.`,
    suggestedFix: { kind: 'prompt', text: `Open the latest failed run on ${defaultBranch}, read the first failing step, and fix it before merging anything else.` },
  }]
}

// ── deploy ───────────────────────────────────────────────────────────────────

export interface DeployTargetDecl {
  id: string
  kind: string
  maxLagHours?: number
}

export interface DeployObservation {
  target_id: string
  observed_commit: string | null
  observed_version: string | null
  ok: boolean
  error: string | null
  observed_at: string
  source: string
}

const MOBILE_KIND = /android|ios|capacitor|expo|mobile|play|app-store|appstore|react-native/i

/** Two commit SHAs name the same commit (a short SHA of 7+ characters matches its full form). */
export function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  if (x.length < 7 || y.length < 7) return x === y
  return x.startsWith(y) || y.startsWith(x)
}

function majorMinor(v: string | null): [number, number] | null {
  const m = /^v?(\d+)\.(\d+)/.exec((v ?? '').trim())
  return m ? [Number(m[1]), Number(m[2])] : null
}

/**
 * `not_deployed` (the default-branch head is not live after `maxLagHours`,
 * default 24, counted from the head commit), `probe_failed` (the newest
 * observation failed) and `platform_skew` (web vs mobile versions more than
 * `platformSkewLimit` minors apart, default 1; any major gap counts). A
 * target with no observation is listed in `unobserved` and gets no finding.
 */
export function deployDrift(input: {
  targets: readonly DeployTargetDecl[]
  observations: readonly DeployObservation[]
  headSha: string | null
  headCommittedAt: string | null
  now: Date
  platformSkewLimit?: number
}): { findings: DriftFinding[]; unobserved: string[] } {
  const findings: DriftFinding[] = []
  const unobserved: string[] = []
  const latestOk: Array<{ target: DeployTargetDecl; version: [number, number]; raw: string }> = []
  for (const target of input.targets) {
    const latest = input.observations
      .filter((o) => o.target_id === target.id)
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0]
    if (!latest) {
      unobserved.push(target.id)
      continue
    }
    if (!latest.ok) {
      findings.push({
        gate: 'deploy_drift', ruleId: 'probe_failed', severity: 'warn',
        message: `The deploy check for ${target.id} failed${latest.error ? `: ${latest.error.slice(0, 200)}` : ''}. Mushi cannot tell which version is live.`,
        suggestedFix: { kind: 'prompt', text: `Open the version URL for ${target.id} in a browser. It should return JSON with \`version\` and \`commit\`.` },
      })
      continue
    }
    const v = majorMinor(latest.observed_version)
    if (v) latestOk.push({ target, version: v, raw: latest.observed_version! })
    if (!input.headSha || !latest.observed_commit || !input.headCommittedAt) continue
    if (sameCommit(latest.observed_commit, input.headSha)) continue
    const lagHours = (input.now.getTime() - Date.parse(input.headCommittedAt)) / 3_600_000
    const max = target.maxLagHours ?? 24
    if (lagHours > max) {
      findings.push({
        gate: 'deploy_drift', ruleId: 'not_deployed', severity: 'warn',
        message: `${target.id} is still on ${latest.observed_commit.slice(0, 7)}, but ${input.headSha.slice(0, 7)} has been on the default branch for ${Math.floor(lagHours)} hours. Merged fixes are not live yet.`,
        suggestedFix: { kind: 'prompt', text: `Check the deploy workflow for ${target.id}: did the last run on the default branch succeed, and did it publish?` },
      })
    }
  }
  const limit = input.platformSkewLimit ?? 1
  const web = latestOk.filter((x) => !MOBILE_KIND.test(x.target.kind))
  const mobile = latestOk.filter((x) => MOBILE_KIND.test(x.target.kind))
  outer: for (const w of web) {
    for (const m of mobile) {
      const majorGap = w.version[0] !== m.version[0]
      const minorGap = Math.abs(w.version[1] - m.version[1])
      if (majorGap || minorGap > limit) {
        findings.push({
          gate: 'deploy_drift', ruleId: 'platform_skew', severity: 'warn',
          message: `Web (${w.target.id}) is on ${w.raw} but ${m.target.id} is on ${m.raw}. Users on different platforms see different fixes.`,
          suggestedFix: { kind: 'prompt', text: `Ship the next store release for ${m.target.id}, or push an over-the-air update if the change is JavaScript only.` },
        })
        break outer
      }
    }
  }
  return { findings, unobserved }
}

// ── env (names only) ─────────────────────────────────────────────────────────

export interface EnvDecl {
  name: string
  in: string[]
  environments: string[]
}

const PLATFORM_NAME = /^(GITHUB_|ACTIONS_|RUNNER_)/
const APP_CONFIG_NAME = /^[A-Z][A-Z0-9_]*$/

/**
 * `env_missing` (declared, absent where declared), `env_undeclared` (a repo
 * Actions name not in the manifest; info) and `env_example_mismatch`
 * (manifest vs `.env.example`). A location whose names were not listed
 * (`runtime`, or an environment missing from `present`) is not checked.
 */
export function envDrift(input: {
  declared: readonly EnvDecl[]
  present: Record<string, readonly string[]>
  exampleNames: readonly string[] | null
}): DriftFinding[] {
  const out: DriftFinding[] = []
  for (const decl of input.declared) {
    for (const where of decl.in) {
      if (where === 'runtime') continue
      const names = input.present[where]
      if (!names) continue
      if (!names.includes(decl.name)) {
        const env = where.startsWith('github-environment:') ? where.slice('github-environment:'.length) : null
        out.push({
          gate: 'env_drift', ruleId: 'env_missing', severity: 'error',
          message: `${decl.name} is declared but missing from ${env ? `the GitHub "${env}" environment` : 'the repo\'s GitHub Actions secrets and variables'}. Builds that need it run without it.`,
          suggestedFix: { kind: 'command', text: `gh secret set ${decl.name}${env ? ` --env ${env}` : ''} --body "<value>"` },
        })
      }
    }
  }
  const declaredNames = new Set(input.declared.map((d) => d.name))
  const undeclared = (input.present['github-actions'] ?? [])
    .filter((n) => !declaredNames.has(n) && !PLATFORM_NAME.test(n) && APP_CONFIG_NAME.test(n))
  if (undeclared.length > 0 && input.declared.length > 0) {
    out.push({
      gate: 'env_drift', ruleId: 'env_undeclared', severity: 'info',
      message: `The repo has ${undeclared.length} Actions ${undeclared.length === 1 ? 'name' : 'names'} the recipe does not list: ${undeclared.slice(0, 10).join(', ')}${undeclared.length > 10 ? '…' : ''}.`,
      suggestedFix: { kind: 'prompt', text: 'Add the names your builds need to `env.required` in mushi.recipe.json, or delete the ones nothing uses.' },
    })
  }
  if (input.exampleNames) {
    const example = new Set(input.exampleNames)
    const notInExample = [...declaredNames].filter((n) => !example.has(n))
    const notDeclared = input.exampleNames.filter((n) => !declaredNames.has(n))
    if (notInExample.length > 0 || notDeclared.length > 0) {
      const parts: string[] = []
      if (notInExample.length) parts.push(`missing from .env.example: ${notInExample.join(', ')}`)
      if (notDeclared.length) parts.push(`only in .env.example: ${notDeclared.join(', ')}`)
      out.push({
        gate: 'env_drift', ruleId: 'env_example_mismatch', severity: 'warn',
        message: `.env.example and the recipe disagree (${parts.join('; ')}).`,
        suggestedFix: { kind: 'prompt', text: 'Make .env.example list the same names as `env.required` in mushi.recipe.json, with placeholder values only.' },
      })
    }
  }
  return out
}

// ── schema ───────────────────────────────────────────────────────────────────

/** The migration version: the leading digits of a filename (`20261002180000_x.sql` → `20261002180000`). */
export function migrationVersion(nameOrVersion: string): string | null {
  const base = nameOrVersion.split('/').pop() ?? nameOrVersion
  const m = /^(\d{3,})/.exec(base.trim())
  return m ? m[1] : null
}

/** `migration_unapplied` (in the repo, not applied) and `migration_unknown_remote` (applied, not in the repo). */
export function schemaMigrationDrift(input: { declared: readonly string[]; applied: readonly string[] }): DriftFinding[] {
  const out: DriftFinding[] = []
  const applied = new Set(input.applied.map(migrationVersion).filter((v): v is string => Boolean(v)))
  const declaredByVersion = new Map<string, string>()
  for (const f of input.declared) {
    const v = migrationVersion(f)
    if (v) declaredByVersion.set(v, f)
  }
  for (const [v, file] of [...declaredByVersion].sort(([a], [b]) => a.localeCompare(b))) {
    if (applied.has(v)) continue
    out.push({
      gate: 'schema_drift', ruleId: 'migration_unapplied', severity: 'error', filePath: file,
      message: `The migration ${file.split('/').pop()} is in the repo but was never applied to the database. Code that needs it will fail, often as a 404 that looks like a UI bug.`,
      suggestedFix: { kind: 'command', text: 'supabase db push' },
    })
  }
  const remoteOnly = [...applied].filter((v) => !declaredByVersion.has(v)).sort()
  if (remoteOnly.length > 0) {
    out.push({
      gate: 'schema_drift', ruleId: 'migration_unknown_remote', severity: 'warn',
      message: `${remoteOnly.length} applied ${remoteOnly.length === 1 ? 'migration is' : 'migrations are'} not in the repo: ${remoteOnly.slice(0, 10).join(', ')}${remoteOnly.length > 10 ? '…' : ''}. A fresh database built from the repo would differ.`,
      suggestedFix: { kind: 'command', text: 'supabase migration fetch' },
    })
  }
  return out
}

// ── integrations ─────────────────────────────────────────────────────────────

const HEALTHY = new Set(['ok', 'healthy', 'up', 'pass', 'connected'])

/**
 * `integration_declared_missing`, `integration_down_24h` (every health row
 * for 24 h or more is non-ok) and `sentry_project_mismatch`.
 */
export function integrationDrift(input: {
  declared: { sentry?: { project?: string }; slack?: Record<string, unknown>; linear?: Record<string, unknown> }
  configured: { sentry?: { projectSlug: string | null }; slack?: boolean; linear?: boolean }
  health: ReadonlyArray<{ kind: string; status: string; checked_at: string }>
  now: Date
}): DriftFinding[] {
  const out: DriftFinding[] = []
  const missing: string[] = []
  if (input.declared.sentry && !input.configured.sentry) missing.push('Sentry')
  if (input.declared.slack && !input.configured.slack) missing.push('Slack')
  if (input.declared.linear && !input.configured.linear) missing.push('Linear')
  for (const name of missing) {
    out.push({
      gate: 'env_drift', ruleId: 'integration_declared_missing', severity: 'warn',
      message: `The recipe says this app uses ${name}, but ${name} is not connected in Mushi.`,
      suggestedFix: { kind: 'prompt', text: `Connect ${name} from Integrations in the console, or remove it from \`integrations\` in mushi.recipe.json.` },
    })
  }
  const kinds = [...new Set(input.health.map((h) => h.kind))].sort()
  for (const kind of kinds) {
    const rows = input.health.filter((h) => h.kind === kind).sort((a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at))
    if (rows.length === 0 || HEALTHY.has(rows[0].status.toLowerCase())) continue
    let since = rows[0].checked_at
    for (const r of rows) {
      if (HEALTHY.has(r.status.toLowerCase())) break
      since = r.checked_at
    }
    const hours = (input.now.getTime() - Date.parse(since)) / 3_600_000
    if (hours >= 24) {
      out.push({
        gate: 'env_drift', ruleId: 'integration_down_24h', severity: 'warn',
        message: `${kind} has been failing its health check for ${Math.floor(hours)} hours, so its reports may be missing from the queue.`,
        suggestedFix: { kind: 'prompt', text: `Open Integrations in the console and run the ${kind} test. The usual cause is a revoked token or a changed webhook URL.` },
      })
    }
  }
  const want = input.declared.sentry?.project
  const have = input.configured.sentry?.projectSlug
  if (want && have && want !== have) {
    out.push({
      gate: 'env_drift', ruleId: 'sentry_project_mismatch', severity: 'warn',
      message: `The recipe names the Sentry project "${want}", but Mushi is connected to "${have}". Crashes from the declared project never reach this queue.`,
      suggestedFix: { kind: 'prompt', text: 'Point the Sentry connection at the project the app reports to, or correct `integrations.sentry.project` in mushi.recipe.json.' },
    })
  }
  return out
}

// ── gates: budgets and cadence ───────────────────────────────────────────────

/** `budget_exceeded`: a metric's latest value is over its declared budget. Missing metrics are not judged. */
export function budgetDrift(budgets: Record<string, number>, latest: Record<string, number>): DriftFinding[] {
  const out: DriftFinding[] = []
  for (const [metric, limit] of Object.entries(budgets).sort(([a], [b]) => a.localeCompare(b))) {
    const value = latest[metric]
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(limit)) continue
    if (value > limit) {
      out.push({
        gate: 'code_health', ruleId: 'budget_exceeded', severity: 'warn',
        message: `${metric} is ${value}, over its budget of ${limit}.`,
        suggestedFix: { kind: 'prompt', text: `Find what grew ${metric} in the recent commits and bring it back under ${limit}, or raise the budget in mushi.recipe.json on purpose.` },
      })
    }
  }
  return out
}

/** ISO 8601 duration (PnW, PnD, PTnH, PTnM, PnDTnH) → milliseconds; null when unreadable. */
export function isoDurationMs(iso: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(iso.trim())
  if (!m || iso.trim().toUpperCase() === 'P' || iso.trim().toUpperCase() === 'PT') return null
  const [w, d, h, min] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0))
  const ms = ((w * 7 + d) * 24 + h) * 3_600_000 + min * 60_000
  return ms > 0 ? ms : null
}

/**
 * Gates whose last run is older than their declared cadence, or never ran.
 * Not findings: the caller renders those gates `unknown`, never `ok`.
 * An unreadable cadence is listed with `cadence: null`.
 */
export function cadenceStale(
  cadence: Record<string, string>,
  lastRunAt: Record<string, string | null>,
  now: Date,
): Array<{ gate: string; lastRunAt: string | null; cadence: string | null }> {
  const out: Array<{ gate: string; lastRunAt: string | null; cadence: string | null }> = []
  for (const [gate, iso] of Object.entries(cadence).sort(([a], [b]) => a.localeCompare(b))) {
    const ms = isoDurationMs(iso)
    const last = lastRunAt[gate] ?? null
    if (ms === null) {
      out.push({ gate, lastRunAt: last, cadence: null })
      continue
    }
    if (!last || now.getTime() - Date.parse(last) > ms) out.push({ gate, lastRunAt: last, cadence: iso })
  }
  return out
}
