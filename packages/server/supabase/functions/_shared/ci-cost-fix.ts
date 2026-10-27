/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost-fix.ts
 * PURPOSE: The workflow edits behind the CI cost "Open fix PR" (ADR 0047,
 *          `ci-cost-fix-worker`). One pure transform per advice kind, on the
 *          workflow's YAML text, through the `yaml` Document API so comments,
 *          quoting and key order survive:
 *
 *   add_concurrency    a top-level `concurrency:` group: a pull request's runs
 *                      share one per ref and a new push cancels the old run;
 *                      every other run (a push, a manual run) gets a group of
 *                      its own, so it is never cancelled or dropped from the
 *                      queue. Refused on a workflow that deploys or releases.
 *   skip_drafts        `ready_for_review` added to the pull_request types (the
 *                      defaults written out when there were none), and
 *                      `if: github.event.pull_request.draft != true` on every
 *                      job (joined to an existing `if` with &&), except a job
 *                      that produces a REQUIRED status check: a skipped check
 *                      reads as passing and would let a draft merge untested,
 *                      so that job keeps running and fails at a first step
 *                      named exactly "Draft PRs run no CI" (the host repos'
 *                      pattern; review-followup.ts and merge-queue.ts read the
 *                      name). Refused when the required checks are unknown.
 *   weekly_cron        a schedule that fires more than once a week rewritten
 *                      to once a week, keeping its minute, hour and first day.
 *                      Refused on a workflow that deploys or releases (some
 *                      daily schedules drive staged rollouts on purpose).
 *   ignore_docs_paths  `paths-ignore: DOCS_PATHS_IGNORE` on pull_request and
 *                      push. Refused when the workflow produces a required
 *                      check, or looks like it does, because a skipped workflow
 *                      never reports and the PR could never merge (GitHub,
 *                      "Handling skipped but required checks"); when the
 *                      required checks are unknown; and when an event already
 *                      has `paths:` (GitHub rejects `paths` with `paths-ignore`).
 *
 * Every transform is idempotent: run on its own output it changes nothing.
 * It returns `{ changed, yaml, summary, refused? }`; `yaml` is the input,
 * untouched, unless `changed`.
 *
 * Pure apart from the YAML parser; no Deno globals.
 */

import { isMap, isScalar, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq, type Document, type Pair } from 'npm:yaml@2'
import { CI_COST_FIX_KINDS, type CiCostFixKind } from './ci-overview-types.ts'

export { CI_COST_FIX_KINDS, type CiCostFixKind }

export interface CostFixResult {
  changed: boolean
  /** The new workflow text when `changed`, else the input unchanged. */
  yaml: string
  /** One plain sentence: what changed, or why nothing did. */
  summary: string
  /** Set when Mushi will not make this edit; `summary` says the same. */
  refused?: string
}

export interface CostFixOptions {
  /**
   * Status check names the default branch requires (rulesets and branch
   * protection). Null or absent when Mushi could not read them: then
   * `skip_drafts` and `ignore_docs_paths` refuse, because guessing wrong lets
   * a draft merge untested or leaves a PR that can never merge.
   */
  requiredChecks?: readonly string[] | null
  /** `.github/workflows/deploy.yml`: its file name counts toward "deploys or releases". */
  workflowPath?: string
}

/** GitHub's `pull_request` activity types when a workflow names none. */
export const DEFAULT_PR_TYPES = ['opened', 'synchronize', 'reopened'] as const
/**
 * The docs-only paths `ignore_docs_paths` adds. The one list: the ci-advisor
 * rule `missing_path_filter` imports it, so advice and fix agree.
 */
export const DOCS_PATHS_IGNORE = ['**/*.md', 'docs/**'] as const
export const DRAFT_CONDITION = 'github.event.pull_request.draft != true'
/** The step a required job fails at on a draft (exact name: Mushi's CI readers match it). */
export const DRAFT_GUARD_STEP_NAME = 'Draft PRs run no CI'
const DRAFT_GUARD_STEP_RE = /^draft prs? run no ci\b/i
/**
 * A pull request's runs share one group per ref; any other run (a push, a
 * manual or scheduled run) gets its own group by run id, so it is never
 * cancelled, and never dropped as a pending run when a newer one queues.
 */
export const CONCURRENCY_GROUP = "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}"
/** Cancels a superseded PR run; anything else always finishes. */
export const CANCEL_IN_PROGRESS = "${{ github.event_name == 'pull_request' }}"

const KIND_SET: ReadonlySet<string> = new Set(CI_COST_FIX_KINDS)

export function isCiCostFixKind(v: unknown): v is CiCostFixKind {
  return typeof v === 'string' && KIND_SET.has(v)
}

/** Apply one fix kind to a workflow file. Never throws. */
export function applyCiCostFix(kind: CiCostFixKind, yaml: string, opts: CostFixOptions = {}): CostFixResult {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return refuse(yaml, 'Mushi could not read this workflow file as YAML, so it will not edit it.')
  }
  if (!isMap(doc.get('jobs', true))) return refuse(yaml, 'This workflow has no jobs, so there is nothing to change.')
  try {
    switch (kind) {
      case 'add_concurrency':
        return addConcurrency(doc, yaml, opts)
      case 'skip_drafts':
        return skipDrafts(doc, yaml, opts)
      case 'weekly_cron':
        return weeklyCron(doc, yaml, opts)
      case 'ignore_docs_paths':
        return ignoreDocsPaths(doc, yaml, opts)
      default:
        return refuse(yaml, `Mushi does not know the fix "${String(kind)}".`)
    }
  } catch (err) {
    return refuse(yaml, `Mushi could not apply this fix to the workflow: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
  }
}

function refuse(yaml: string, reason: string): CostFixResult {
  return { changed: false, yaml, summary: reason, refused: reason }
}

function unchanged(yaml: string, summary: string): CostFixResult {
  return { changed: false, yaml, summary }
}

/** Keep the file's own sequence style: `- x` under a key at the key's indent, or indented. */
function render(doc: Document, source: string): string {
  const indentSeq = !/^( *)[^\s#-][^\n]*:[ \t]*(?:#[^\n]*)?\n\1- /m.test(source)
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false, indentSeq })
}

function emptyValue(): Scalar {
  const s = new Scalar(null)
  // Printed as `key:` (as GitHub's docs write an event with no filters), not `key: null`.
  ;(s as Scalar & { source?: string }).source = ''
  return s
}

function scalarString(node: unknown): string | null {
  return isScalar(node) && typeof node.value === 'string' ? node.value : null
}

/**
 * The workflow's `on:` as a map, converting `on: push` and `on: [push, pull_request]`
 * in place. Null when the workflow has no `on:`.
 */
function triggers(doc: Document): YAMLMap | null {
  const on = doc.get('on', true)
  if (isMap(on)) return on
  const events = eventNames(doc)
  if (events.length === 0) return null
  const map = new YAMLMap()
  for (const e of events) map.set(e, emptyValue())
  doc.set('on', map)
  return map
}

/** The events the workflow runs on, without converting anything. */
function eventNames(doc: Document): string[] {
  const on = doc.get('on', true)
  if (isMap(on)) return on.items.map((p) => scalarString(p.key)).filter((k): k is string => k != null)
  if (isScalar(on) && typeof on.value === 'string') return [on.value]
  if (isSeq(on)) return on.items.map((i) => scalarString(i)).filter((k): k is string => k != null)
  return []
}

/** An event's config as a map, turning `pull_request:` (null) into one. */
function eventMap(on: YAMLMap, event: string): YAMLMap {
  const v = on.get(event, true)
  if (isMap(v)) return v
  const map = new YAMLMap()
  on.set(event, map)
  return map
}

function jobEntries(doc: Document): Array<{ id: string; job: YAMLMap }> {
  const jobs = doc.get('jobs', true)
  if (!isMap(jobs)) return []
  const out: Array<{ id: string; job: YAMLMap }> = []
  for (const p of jobs.items as Pair[]) {
    const id = scalarString(p.key)
    if (id && isMap(p.value)) out.push({ id, job: p.value as YAMLMap })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploys, releases and required checks
// ─────────────────────────────────────────────────────────────────────────────

const DEPLOY_WORD = /(?:^|[^a-z0-9])(?:deploy(?:s|ment|ments)?|release(?:s)?|publish(?:es)?|ota)(?:[^a-z0-9]|$)/i
const DEPLOY_COMMAND = /\b(?:eas (?:update|submit)|(?:npm|pnpm|yarn) publish|changeset publish|vercel (?:deploy|--prod)|firebase deploy|supabase (?:functions deploy|db push)|wrangler (?:deploy|publish)|fly deploy|netlify deploy)\b/i

/**
 * What makes the workflow look like it deploys or releases: its name or file,
 * a job id or name, a step name, or a step that runs a deploy or publish
 * command. Null when nothing does.
 */
export function deployEvidence(doc: Document, workflowPath?: string): string | null {
  const name = scalarString(doc.get('name', true))
  if (name && DEPLOY_WORD.test(name)) return `workflow \`${name}\``
  const file = workflowPath?.split('/').pop()
  if (file && DEPLOY_WORD.test(file.replace(/\.ya?ml$/i, ''))) return `file \`${file}\``
  for (const { id, job } of jobEntries(doc)) {
    const jobName = scalarString(job.get('name', true))
    if (DEPLOY_WORD.test(id) || (jobName && DEPLOY_WORD.test(jobName))) return `job \`${jobName ?? id}\``
    const steps = job.get('steps', true)
    if (!isSeq(steps)) continue
    for (const step of steps.items) {
      if (!isMap(step)) continue
      const stepName = scalarString(step.get('name', true))
      if (stepName && DEPLOY_WORD.test(stepName)) return `step \`${stepName}\` in job \`${id}\``
      const run = scalarString(step.get('run', true))
      const cmd = run ? DEPLOY_COMMAND.exec(run)?.[0] : null
      if (cmd) return `\`${cmd}\` in job \`${id}\``
    }
  }
  return null
}

/** The status check names a job reports (its `name:`, else its id; a matrix adds ` (…)`). */
function checkNameMatches(check: string, jobName: string): boolean {
  return check === jobName || check.startsWith(`${jobName} (`) || check.endsWith(` / ${jobName}`)
}

/** The required check this job produces, if any. */
function requiredCheckOf(id: string, job: YAMLMap, required: readonly string[]): string | null {
  const name = scalarString(job.get('name', true)) ?? id
  return required.find((c) => checkNameMatches(c, name) || checkNameMatches(c, id)) ?? null
}

const UNKNOWN_REQUIRED =
  'Mushi could not read which status checks your default branch requires (branch protection and rulesets). Without that list it cannot tell which jobs must keep reporting, so it changes nothing. Check that the GitHub access Mushi uses can read this repository, then try again.'

// ─────────────────────────────────────────────────────────────────────────────
// add_concurrency
// ─────────────────────────────────────────────────────────────────────────────

function addConcurrency(doc: Document, yaml: string, opts: CostFixOptions): CostFixResult {
  if (doc.has('concurrency')) return unchanged(yaml, 'The workflow already has a concurrency group.')
  const deploy = deployEvidence(doc, opts.workflowPath)
  if (deploy) {
    return refuse(
      yaml,
      `This workflow looks like it deploys or releases (${deploy}). Cancelling it part-way could leave a half-finished deploy, and a concurrency group also drops a waiting run when a newer one queues, so Mushi will not add one. If you want deploys to wait their turn, add \`concurrency\` by hand with \`cancel-in-progress: false\`.`,
    )
  }
  const root = doc.contents as YAMLMap
  const pair = doc.createPair('concurrency', { group: CONCURRENCY_GROUP, 'cancel-in-progress': CANCEL_IN_PROGRESS }) as Pair
  ;(pair.key as Scalar).spaceBefore = true
  // After `on:` (and `permissions:` / `env:` when they follow it), before `jobs:`.
  const jobsAt = root.items.findIndex((p) => scalarString(p.key) === 'jobs')
  root.items.splice(jobsAt < 0 ? root.items.length : jobsAt, 0, pair)
  const jobsPair = root.items[root.items.indexOf(pair) + 1]
  if (jobsPair && isScalar(jobsPair.key)) jobsPair.key.spaceBefore = true
  return {
    changed: true,
    yaml: render(doc, yaml),
    summary: 'Added a concurrency group, so a new push to a pull request cancels the run it replaces. Pushes, manual and scheduled runs each get a group of their own and always finish.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// skip_drafts
// ─────────────────────────────────────────────────────────────────────────────

const EXPR_WRAP = /^\s*\$\{\{([\s\S]*)\}\}\s*$/

/** A job `if:` as a bare expression; null when it mixes text and `${{ }}` (Mushi will not guess). */
export function bareCondition(raw: string): string | null {
  const m = EXPR_WRAP.exec(raw)
  const inner = (m ? m[1] : raw).trim()
  if (inner.length === 0 || inner.includes('${{') || inner.includes('}}')) return null
  return inner
}

function mentionsDraft(cond: string): boolean {
  return /pull_request\.draft\b/.test(cond)
}

function skipDrafts(doc: Document, yaml: string, opts: CostFixOptions): CostFixResult {
  if (!eventNames(doc).includes('pull_request')) {
    return refuse(yaml, 'This workflow does not run on pull requests, so drafts already cost nothing here.')
  }
  if (!opts.requiredChecks) return refuse(yaml, UNKNOWN_REQUIRED)
  const required = opts.requiredChecks
  // A required job must keep running on drafts (a skipped check reads as
  // passing). It cannot if it waits on a job that will now be skipped, unless
  // its own `if` runs it anyway (always(), !cancelled(), failure()).
  for (const { id, job } of jobEntries(doc)) {
    const check = requiredCheckOf(id, job, required)
    if (!check) continue
    const label = scalarString(job.get('name', true)) ?? id
    if (job.has('uses') && !job.has('steps')) {
      return refuse(
        yaml,
        `Job \`${label}\` produces the required check \`${check}\` and calls another workflow, so Mushi cannot add the "${DRAFT_GUARD_STEP_NAME}" step to it. Skipping it on drafts would read as passing and let a draft merge untested.`,
      )
    }
    const cond = scalarString(job.get('if', true)) ?? ''
    if (job.has('needs') && !ALWAYS_RUNS.test(cond)) {
      return refuse(
        yaml,
        `Job \`${label}\` produces the required check \`${check}\` and waits on other jobs. If those skip drafts, it would skip too, and a skipped required check reads as passing, so a draft could merge untested. Give it \`if: always()\` (and fail it when a needed job failed), then try again.`,
      )
    }
  }
  const edits: string[] = []
  const on = triggers(doc)!
  const pr = on.get('pull_request', true)
  let types: YAMLSeq | null = null
  const prMap = isMap(pr) ? pr : null
  const existing = prMap?.get('types', true)
  if (isSeq(existing)) types = existing
  const names = types ? types.items.map((i) => scalarString(i)) : isScalar(existing) ? [scalarString(existing)] : null
  if (!names) {
    const map = eventMap(on, 'pull_request')
    const seq = doc.createNode([...DEFAULT_PR_TYPES, 'ready_for_review']) as YAMLSeq
    seq.flow = true
    map.items.unshift(doc.createPair('types', seq) as Pair)
    edits.push('runs when a draft is marked ready for review')
  } else if (!names.includes('ready_for_review')) {
    if (types) types.add(doc.createNode('ready_for_review'))
    else {
      const seq = doc.createNode([...names.filter((n): n is string => n != null), 'ready_for_review']) as YAMLSeq
      seq.flow = true
      prMap!.set('types', seq)
    }
    edits.push('runs when a draft is marked ready for review')
  }

  const skipped: string[] = []
  const guarded: string[] = []
  const unsure: string[] = []
  for (const { id, job } of jobEntries(doc)) {
    if (requiredCheckOf(id, job, required)) {
      if (addDraftGuardStep(doc, job)) guarded.push(id)
      continue
    }
    const node = job.get('if', true)
    if (node == null) {
      const pair = doc.createPair('if', DRAFT_CONDITION) as Pair
      const nameAt = job.items.findIndex((p) => scalarString(p.key) === 'name')
      job.items.splice(nameAt + 1, 0, pair)
      skipped.push(id)
      continue
    }
    const raw = isScalar(node) ? (typeof node.value === 'boolean' ? String(node.value) : scalarString(node)) : null
    if (raw == null) {
      unsure.push(id)
      continue
    }
    if (mentionsDraft(raw)) continue
    const cond = bareCondition(raw)
    if (!cond) {
      unsure.push(id)
      continue
    }
    ;(node as Scalar).value = `(${cond}) && ${DRAFT_CONDITION}`
    skipped.push(id)
  }
  if (skipped.length > 0) edits.push(`skips draft pull requests in ${listOf(skipped)}`)
  if (guarded.length > 0) {
    edits.push(`stops ${listOf(guarded)} at a first step named "${DRAFT_GUARD_STEP_NAME}" on a draft: ${guarded.length === 1 ? 'it produces a required check, which' : 'they produce required checks, which'} must not read as passing, so a draft can never merge untested`)
  }

  if (edits.length === 0) {
    return unsure.length > 0
      ? refuse(yaml, `Mushi could not safely add the draft check to ${listOf(unsure)}: their \`if:\` mixes text and expressions. Add \`${DRAFT_CONDITION}\` by hand.`)
      : unchanged(yaml, 'The workflow already skips draft pull requests.')
  }
  const note = unsure.length > 0 ? ` Left ${listOf(unsure)} alone: add \`${DRAFT_CONDITION}\` to their \`if:\` by hand.` : ''
  return { changed: true, yaml: render(doc, yaml), summary: `The workflow now ${edits.join(' and ')}.${note}` }
}

/**
 * Put the draft guard first in a required job's steps: on a draft it fails
 * the job (the check is red, the PR cannot merge) and the other steps skip.
 * False when the job already has it.
 */
function addDraftGuardStep(doc: Document, job: YAMLMap): boolean {
  const steps = job.get('steps', true)
  if (!isSeq(steps)) return false
  if (steps.items.some((st) => isMap(st) && DRAFT_GUARD_STEP_RE.test(scalarString(st.get('name', true)) ?? ''))) return false
  steps.items.unshift(
    doc.createNode({
      name: DRAFT_GUARD_STEP_NAME,
      if: 'github.event.pull_request.draft == true',
      run: 'echo "Draft pull requests run no CI. Mark the pull request ready for review to run it." && exit 1',
    }),
  )
  return true
}

function listOf(ids: readonly string[]): string {
  const q = ids.map((i) => `\`${i}\``)
  if (q.length <= 1) return `job ${q[0] ?? ''}`.trim()
  return `jobs ${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`
}

// ─────────────────────────────────────────────────────────────────────────────
// weekly_cron
// ─────────────────────────────────────────────────────────────────────────────

const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const MONTH_NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

interface CronField {
  values: Set<number>
  /** `*` (or `*` with a step): matters for the day-of-month / day-of-week OR rule. */
  star: boolean
  /** The first value written, for the rewrite. */
  first: number | null
}

function parseField(text: string, min: number, max: number, names?: Record<string, number>): CronField | null {
  const values = new Set<number>()
  let first: number | null = null
  const star = text.startsWith('*')
  const num = (s: string): number | null => {
    const lower = s.toLowerCase()
    if (names && lower in names) return names[lower]
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    return n === 7 && max === 6 ? 0 : n
  }
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) return null
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      const x = num(a)
      const y = num(b)
      if (x == null || y == null) return null
      lo = x
      hi = y
    } else {
      const x = num(range)
      if (x == null) return null
      lo = x
      hi = stepText === undefined ? x : max
    }
    if (lo < min || hi > (max === 6 ? 7 : max) || lo > hi) return null
    if (first == null && range !== '*') first = lo
    for (let v = lo; v <= hi; v += step) values.add(max === 6 && v === 7 ? 0 : v)
  }
  return values.size > 0 ? { values, star, first } : null
}

export interface ParsedCron {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

export function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minute = parseField(parts[0], 0, 59)
  const hour = parseField(parts[1], 0, 23)
  const dom = parseField(parts[2], 1, 31)
  const month = parseField(parts[3], 1, 12, MONTH_NAMES)
  const dow = parseField(parts[4], 0, 6, DOW_NAMES)
  return minute && hour && dom && month && dow ? { minute, hour, dom, month, dow } : null
}

/** Whether the schedule fires at this UTC minute (POSIX: day-of-month OR day-of-week when both are set). */
function fires(c: ParsedCron, t: Date): boolean {
  if (!c.minute.values.has(t.getUTCMinutes()) || !c.hour.values.has(t.getUTCHours())) return false
  if (!c.month.values.has(t.getUTCMonth() + 1)) return false
  const domOk = c.dom.values.has(t.getUTCDate())
  const dowOk = c.dow.values.has(t.getUTCDay())
  if (c.dom.star && c.dow.star) return true
  if (c.dom.star) return dowOk
  if (c.dow.star) return domOk
  return domOk || dowOk
}

/** Fires in 28 days of a 31-day month (2026-03-01, a Sunday), all schedules together. */
export function firesPer28Days(crons: readonly ParsedCron[]): number {
  const start = Date.UTC(2026, 2, 1)
  let n = 0
  for (let m = 0; m < 28 * 24 * 60; m++) {
    const t = new Date(start + m * 60_000)
    if (crons.some((c) => fires(c, t))) n++
  }
  return n
}

/** Once a week, at the schedule's first minute, hour and weekday (Monday when it named none). */
export function weeklyCronFor(c: ParsedCron): string {
  const minute = c.minute.first ?? 0
  const hour = c.hour.first ?? 0
  const day = c.dow.star ? 1 : c.dow.first ?? 1
  return `${minute} ${hour} * * ${day}`
}

function weeklyCron(doc: Document, yaml: string, opts: CostFixOptions): CostFixResult {
  const on = doc.get('on', true)
  const schedule = isMap(on) ? on.get('schedule', true) : null
  if (!isSeq(schedule) || schedule.items.length === 0) {
    return refuse(yaml, 'This workflow has no schedule, so there is no cron to change.')
  }
  const entries: Array<{ node: Scalar; cron: ParsedCron; text: string }> = []
  for (const item of schedule.items) {
    const node = isMap(item) ? item.get('cron', true) : null
    const text = scalarString(node)
    const cron = text ? parseCron(text) : null
    if (!node || !text || !cron) return refuse(yaml, `Mushi could not read the schedule \`${text ?? '?'}\`, so it will not change it.`)
    entries.push({ node: node as Scalar, cron, text })
  }
  if (firesPer28Days(entries.map((e) => e.cron)) <= 4) return unchanged(yaml, 'The schedule already runs at most once a week.')
  const deploy = deployEvidence(doc, opts.workflowPath)
  if (deploy) {
    return refuse(
      yaml,
      `This scheduled workflow looks like it deploys or releases (${deploy}). Some daily schedules drive staged rollouts on purpose, so Mushi will not change how often it runs.`,
    )
  }
  const next = weeklyCronFor(entries[0].cron)
  entries[0].node.value = next
  schedule.items.splice(1)
  const was = entries.map((e) => `\`${e.text}\``).join(', ')
  return {
    changed: true,
    yaml: render(doc, yaml),
    summary: `The schedule now runs once a week (\`${next}\`, UTC). It was ${was}; put that back if something depends on the old schedule.`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ignore_docs_paths
// ─────────────────────────────────────────────────────────────────────────────

/** Job ids and names that usually back a required status check ("all green" aggregators). */
const AGGREGATOR_NAME = /^(?:gate|gates|required|required[-_ ]checks?|all[-_ ]?(?:green|checks|passed|done|jobs)|alls[-_ ]green|ci[-_ ]?(?:ok|success|pass(?:ed)?|done|gate|status|result|complete)|checks?[-_ ]?(?:passed|complete)|status[-_ ]checks?|ready[-_ ]to[-_ ]merge|merge[-_ ]gate|final|done|success)$/i
const ALWAYS_RUNS = /\b(?:always|failure|cancelled)\(\)/

/**
 * A job that looks like the one a branch rule requires: named like an
 * aggregator, or one that needs two or more jobs and still runs when they fail.
 * Null when none does.
 */
export function requiredLookingJob(doc: Document): string | null {
  for (const { id, job } of jobEntries(doc)) {
    const name = scalarString(job.get('name', true))
    if (AGGREGATOR_NAME.test(id) || (name && AGGREGATOR_NAME.test(name))) return name ?? id
    const needs = job.get('needs', true)
    const many = isSeq(needs) && needs.items.length >= 2
    const cond = scalarString(job.get('if', true)) ?? ''
    if (many && ALWAYS_RUNS.test(cond)) return name ?? id
  }
  return null
}

function ignoreDocsPaths(doc: Document, yaml: string, opts: CostFixOptions): CostFixResult {
  const events = eventNames(doc).filter((e) => e === 'pull_request' || e === 'push')
  if (events.length === 0) return refuse(yaml, 'This workflow does not run on pushes or pull requests, so a path filter would not change anything.')

  if (!opts.requiredChecks) return refuse(yaml, UNKNOWN_REQUIRED)
  const required = opts.requiredChecks
  for (const { id, job } of jobEntries(doc)) {
    const hit = requiredCheckOf(id, job, required)
    if (hit) {
      return refuse(
        yaml,
        `\`${hit}\` is a required check on your default branch. A docs-only pull request would skip this whole workflow, that check would never report, and the pull request could not merge. Skip the expensive steps inside the job instead (a changed-files step), or drop the requirement first.`,
      )
    }
  }
  const aggregator = requiredLookingJob(doc)
  if (aggregator) {
    return refuse(
      yaml,
      `Job \`${aggregator}\` looks like the check your branch rules require. A docs-only pull request would skip this whole workflow, that check would never report, and the pull request could not merge. Skip the expensive steps inside the job instead (a changed-files step).`,
    )
  }

  for (const event of events) {
    const current = isMap(doc.get('on', true)) ? (doc.get('on', true) as YAMLMap).get(event, true) : null
    if (isMap(current) && current.has('paths')) {
      return refuse(
        yaml,
        `The \`${event}\` trigger already lists \`paths\`, and GitHub does not allow \`paths\` and \`paths-ignore\` on the same event. Add \`!**/*.md\` and \`!docs/**\` to its \`paths\` by hand instead.`,
      )
    }
  }

  const on = triggers(doc)!
  const added: string[] = []
  for (const event of events) {
    const current = on.get(event, true)
    if (isMap(current) && current.has('paths-ignore')) continue
    // A push filtered to tags only: paths are not evaluated for tags, nothing to save.
    if (isMap(current) && event === 'push' && (current.has('tags') || current.has('tags-ignore')) && !current.has('branches') && !current.has('branches-ignore')) continue
    const map = eventMap(on, event)
    const seq = doc.createNode([...DOCS_PATHS_IGNORE]) as YAMLSeq
    seq.flow = true
    for (const item of seq.items) if (isScalar(item)) item.type = Scalar.QUOTE_SINGLE
    map.set('paths-ignore', seq)
    added.push(event)
  }
  if (added.length === 0) return unchanged(yaml, 'Its triggers already have path filters.')
  return {
    changed: true,
    yaml: render(doc, yaml),
    summary: `A ${added.join(' or ')} that only changes Markdown files or \`docs/\` no longer runs this workflow.`,
  }
}
