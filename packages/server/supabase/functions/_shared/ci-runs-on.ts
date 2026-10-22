/**
 * FILE: packages/server/supabase/functions/_shared/ci-runs-on.ts
 * PURPOSE: Where each job of a workflow asks to run (Plan 022 Phase 7,
 *          ADR 0037). Reads `runs-on:` from the workflow YAML and sorts every
 *          job into one of:
 *
 *   follows_variable    `${{ … vars.LINUX_RUNNER … || 'ubuntu-24.04' }}`: the
 *                       repo variable picks the runner, the literal after
 *                       `||` is the GitHub-hosted fallback when it is unset
 *   pinned_hosted       a literal GitHub-hosted label (`ubuntu-latest`,
 *                       `macos-15`); the YAML comment on that line (or the
 *                       line above) is the reason, when there is one
 *   pinned_self_hosted  a literal custom or `self-hosted` label
 *   expression          anything else (`${{ matrix.os }}`): Mushi cannot tell
 *
 * Plus two guards a variable never overrides: `github.ref != 'refs/heads/main'`
 * keeps main-branch runs on GitHub, `github.actor != 'dependabot[bot]'` keeps
 * Dependabot's.
 *
 * Real forms seen on 2026-10-22 (kensaurus repos):
 *   runs-on: ${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-latest' }}
 *   runs-on: ubuntu-latest  # pixel baselines are captured on GitHub-hosted ubuntu; keep hosted
 *
 * Pure apart from the YAML parser.
 */

import { isMap, isScalar, isSeq, parseDocument } from 'npm:yaml@2'

export type RunsOnKind = 'follows_variable' | 'pinned_hosted' | 'pinned_self_hosted' | 'expression'

export interface RunsOnJob {
  /** `.github/workflows/ci.yml` */
  workflowPath: string
  /** The workflow's `name:`, or null. GitHub shows the path when there is none. */
  workflowName: string | null
  /** The job's key under `jobs:`. */
  jobId: string
  /** The job's `name:` (may contain `${{ }}`), or null. */
  jobName: string | null
  /** The `runs-on` value as written (one line). */
  runsOn: string
  kind: RunsOnKind
  /** Repo variables the expression reads (`vars.X`), in order. */
  variables: string[]
  /** The quoted literal after the last `||`, or null. */
  fallbackLabel: string | null
  /** Literal labels for pinned jobs (and a `labels:` list). */
  labels: string[]
  /** The YAML comment that explains a pin, or null. */
  pinnedReason: string | null
  /** The expression keeps runs on main on the fallback (GitHub). */
  hostedOnMain: boolean
  /** The expression keeps Dependabot's runs on the fallback (GitHub). */
  hostedForDependabot: boolean
  /** The job only runs on pull requests (its `if:` checks the event name). */
  pullRequestOnly: boolean
}

export interface ParsedWorkflow {
  path: string
  name: string | null
  /** Trigger names (`pull_request`, `push`, `schedule`, …). */
  triggers: string[]
  jobs: RunsOnJob[]
  /** Set when the YAML could not be parsed. */
  error: string | null
}

const HOSTED_LABEL_RE = /^(?:ubuntu|windows|macos)-[\w.-]+$/i
const VAR_RE = /\bvars\.([A-Za-z_][A-Za-z0-9_]*)/g
const FALLBACK_RE = /\|\|\s*'([^']+)'\s*\)?\s*\}\}\s*$/
const MAIN_GUARD_RE = /github\.ref\s*!=\s*'refs\/heads\/(?:main|master)'/
const DEPENDABOT_GUARD_RE = /github\.actor\s*!=\s*'dependabot\[bot\]'/
const PR_ONLY_RE = /github\.event_name\s*==\s*'pull_request(?:_target)?'/

/** True for a label GitHub hosts (standard runners). */
export function isHostedLabel(label: string): boolean {
  return HOSTED_LABEL_RE.test(label.trim())
}

function lineAt(text: string, offset: number): { line: string; index: number } {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const end = text.indexOf('\n', offset)
  const line = text.slice(start, end === -1 ? text.length : end)
  const index = text.slice(0, start).split('\n').length - 1
  return { line, index }
}

/** The comment after `#` on a line, outside quotes; null when none. */
function trailingComment(line: string): string | null {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      const c = line.slice(i + 1).trim()
      return c || null
    }
  }
  return null
}

/** The pin's reason: the comment on the `runs-on:` line, else a comment-only line right above it. */
function reasonFor(text: string, offset: number): string | null {
  const { line, index } = lineAt(text, offset)
  const same = trailingComment(line)
  if (same) return same.slice(0, 300)
  const lines = text.split('\n')
  const above = lines[index - 1]?.trim() ?? ''
  if (above.startsWith('#')) {
    const c = above.replace(/^#+\s*/, '').trim()
    return c ? c.slice(0, 300) : null
  }
  return null
}

/** Classify one `runs-on` value (already flattened to a string or a label list). */
export function classifyRunsOn(value: string | string[]): Pick<RunsOnJob, 'kind' | 'variables' | 'fallbackLabel' | 'labels' | 'hostedOnMain' | 'hostedForDependabot'> {
  if (Array.isArray(value)) {
    const labels = value.map((l) => l.trim()).filter(Boolean)
    const exprs = labels.filter((l) => l.includes('${{'))
    if (exprs.length > 0) return classifyRunsOn(exprs.join(' '))
    const hosted = labels.length > 0 && labels.every(isHostedLabel)
    return { kind: hosted ? 'pinned_hosted' : 'pinned_self_hosted', variables: [], fallbackLabel: null, labels, hostedOnMain: false, hostedForDependabot: false }
  }
  const v = value.trim()
  if (!v.includes('${{')) return classifyRunsOn([v])
  const variables = [...new Set([...v.matchAll(VAR_RE)].map((m) => m[1]))]
  const fallbackLabel = FALLBACK_RE.exec(v)?.[1] ?? null
  return {
    kind: variables.length > 0 ? 'follows_variable' : 'expression',
    variables,
    fallbackLabel,
    labels: [],
    hostedOnMain: variables.length > 0 && MAIN_GUARD_RE.test(v),
    hostedForDependabot: variables.length > 0 && DEPENDABOT_GUARD_RE.test(v),
  }
}

function scalarString(node: unknown): string | null {
  if (isScalar(node)) return node.value == null ? null : String(node.value)
  return null
}

/** Parse one workflow file. Never throws: a bad file comes back with `error` and no jobs. */
export function parseWorkflowRunsOn(path: string, text: string): ParsedWorkflow {
  let doc
  try {
    doc = parseDocument(text, { prettyErrors: false })
  } catch (err) {
    return { path, name: null, triggers: [], jobs: [], error: err instanceof Error ? err.message : String(err) }
  }
  if (doc.errors.length > 0) return { path, name: null, triggers: [], jobs: [], error: doc.errors[0].message }
  const root = doc.contents
  if (!isMap(root)) return { path, name: null, triggers: [], jobs: [], error: 'not a mapping' }
  const name = scalarString(root.get('name', true))
  // `on` may parse as the boolean true key in YAML 1.1 readers; yaml@2 keeps the string.
  const on = root.get('on', true) ?? root.get(true as unknown as string, true)
  const triggers = isMap(on)
    ? on.items.map((p) => String(isScalar(p.key) ? p.key.value : p.key))
    : isSeq(on)
      ? on.items.map((x) => scalarString(x) ?? '').filter(Boolean)
      : scalarString(on)
        ? [scalarString(on) as string]
        : []
  const jobsNode = root.get('jobs', true)
  const jobs: RunsOnJob[] = []
  if (isMap(jobsNode)) {
    for (const pair of jobsNode.items) {
      const jobId = String(isScalar(pair.key) ? pair.key.value : pair.key)
      const job = pair.value
      if (!isMap(job)) continue
      const runsOnPair = job.items.find((p) => isScalar(p.key) && p.key.value === 'runs-on')
      if (!runsOnPair) continue // a reusable workflow call (`uses:`) runs where that workflow says
      const node = runsOnPair.value
      let flat: string | string[]
      if (isSeq(node)) flat = node.items.map((x) => scalarString(x) ?? '').filter(Boolean)
      else if (isMap(node)) {
        const labels = node.get('labels', true)
        const group = scalarString(node.get('group', true))
        flat = isSeq(labels) ? labels.items.map((x) => scalarString(x) ?? '').filter(Boolean) : scalarString(labels) ? [scalarString(labels) as string] : group ? [group] : []
      } else flat = scalarString(node) ?? ''
      const cls = classifyRunsOn(flat)
      const keyOffset = isScalar(runsOnPair.key) && runsOnPair.key.range ? runsOnPair.key.range[0] : 0
      const ifText = scalarString(job.get('if', true)) ?? ''
      jobs.push({
        workflowPath: path,
        workflowName: name,
        jobId,
        jobName: scalarString(job.get('name', true)),
        runsOn: Array.isArray(flat) ? `[${flat.join(', ')}]` : flat,
        ...cls,
        pinnedReason: cls.kind === 'pinned_hosted' || cls.kind === 'pinned_self_hosted' ? reasonFor(text, keyOffset) : null,
        pullRequestOnly: PR_ONLY_RE.test(ifText),
      })
    }
  }
  return { path, name, triggers, jobs, error: null }
}

/** GitHub's display name for a workflow: its `name:`, else the file path. */
export function workflowDisplayName(w: Pick<ParsedWorkflow, 'name' | 'path'>): string {
  return w.name ?? w.path
}

/**
 * True when a stored job (ci_jobs.workflow_name / job_name) is this YAML job.
 * A matrix job reads "build (ubuntu, 18)"; a name with `${{ }}` matches on
 * the text before the expression.
 */
export function runsOnJobMatches(job: RunsOnJob, workflowName: string | null, jobName: string): boolean {
  const wf = job.workflowName ?? job.workflowPath
  if (workflowName && workflowName !== wf && workflowName !== job.workflowPath) return false
  const display = (job.jobName ?? job.jobId).trim()
  const prefix = display.includes('${{') ? display.slice(0, display.indexOf('${{')).trim() : display
  if (!prefix) return false
  return jobName === display || jobName === prefix || jobName.startsWith(`${prefix} (`) || (display.includes('${{') && jobName.startsWith(prefix))
}

/** Every job of every workflow of one repo. */
export function parseRepoWorkflows(files: ReadonlyArray<{ path: string; text: string }>): ParsedWorkflow[] {
  return files.map((f) => parseWorkflowRunsOn(f.path, f.text))
}
