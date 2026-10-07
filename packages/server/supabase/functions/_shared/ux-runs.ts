/**
 * FILE: packages/server/supabase/functions/_shared/ux-runs.ts
 * PURPOSE: Pure helpers for the `mushi-ux` console mirror (Plan 021, ADR 0020):
 *          storage paths, the report a flagged screen files, and run counts.
 *
 * OVERVIEW:
 * - Every object path lives under `<project_id>/<run_id>/`, so a caller can
 *   only mint upload URLs inside its own project's run.
 * - A flagged screen becomes a normal report (source 'ux_loop', ADR 0004),
 *   pre-classified as visual from the loop's measurements; no LLM call, so it
 *   bills nothing (billing policy, PR #441).
 */

export const UX_CAPTURES_BUCKET = 'ux-captures'
export const UX_LOOP_REPORTER = 'ux-loop'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}\/(?:before|after|diff|iter(?:[1-9]|1[0-9]|20)-(?:after|diff))-(?:desktop|mobile)\.png$/
const SURFACE_SLOT_RE = /^(?:before|after|diff)-(?:desktop|mobile)$/
const ITERATION_SLOT_RE = /^(?:after|diff)-(?:desktop|mobile)$/

/**
 * `<surfaceKey>/<before|after|diff>-<viewport>.png`, or an attempt's
 * `<surfaceKey>/iter<n>-<after|diff>-<viewport>.png` → full bucket path, or
 * null if malformed.
 */
export function uxCapturePath(projectId: string, runId: string, name: string): string | null {
  if (!NAME_RE.test(name)) return null
  return `${projectId}/${runId}/${name}`
}

/**
 * A snapshot's `shots` map (slot → upload name) → slot → bucket path. Names
 * outside this screen's folder, or for another slot kind, are dropped.
 */
export function uxShotPaths(
  projectId: string,
  runId: string,
  surfaceKey: string,
  shots: Record<string, string> | undefined,
  kind: 'surface' | 'iteration',
): Record<string, string> {
  const slotRe = kind === 'surface' ? SURFACE_SLOT_RE : ITERATION_SLOT_RE
  const out: Record<string, string> = {}
  for (const [slot, name] of Object.entries(shots ?? {})) {
    if (!slotRe.test(slot) || !name.startsWith(`${surfaceKey}/`)) continue
    const path = uxCapturePath(projectId, runId, name)
    if (path) out[slot] = path
  }
  return out
}

export interface UxProbeSummary {
  axe?: Array<{ id: string; impact: string | null; help: string; count: number }>
  overflowX?: boolean
  smallTargets?: number
  consoleErrors?: number
  cls?: number
}

export interface UxJudgeSummary {
  viewport: string
  preferred: 'before' | 'after' | 'tie'
  confidence: 'low' | 'medium' | 'high'
  summary: string
  worse?: Array<{ what: string; why: string }>
  error?: string
}

export interface UxSurfaceForReport {
  surface_key: string
  kind: string
  path: string
  label: string
  status: string
  note: string | null
  penalty_before: number | null
  penalty_after: number | null
  probe_after: UxProbeSummary | null
  probe_before: UxProbeSummary | null
  judge: UxJudgeSummary[] | null
}

function problemLines(p: UxProbeSummary | null): string[] {
  if (!p) return []
  const lines = (p.axe ?? []).map((v) => `- ${v.help} (${v.id}, ${v.impact ?? 'n/a'}, ${v.count} element${v.count === 1 ? '' : 's'})`)
  if (p.overflowX) lines.push('- The page scrolls sideways.')
  if (p.smallTargets) lines.push(`- ${p.smallTargets} tap target(s) smaller than 24×24 px.`)
  if (p.consoleErrors) lines.push(`- ${p.consoleErrors} console error(s) while the screen loads.`)
  if (p.cls && p.cls > 0.1) lines.push(`- Layout shift ${p.cls} while loading.`)
  return lines
}

/** The row "File as bug" inserts for one screen of a run. */
export function buildUxLoopReport(
  projectId: string,
  runId: string,
  s: UxSurfaceForReport,
  now: Date,
): Record<string, unknown> {
  // What is still wrong now: the kept version if there is one, else the original.
  const current = s.probe_after ?? s.probe_before
  const problems = problemLines(current)
  const reviewerWorse = (s.judge ?? [])
    .filter((j) => !j.error)
    .flatMap((j) => (j.worse ?? []).map((w) => `- [${j.viewport}] ${w.what}: ${w.why}`))
  const headline =
    s.status === 'regressed'
      ? `"${s.label}" changed after another screen's fix`
      : problems.length > 0
        ? `${problems.length} UX problem${problems.length === 1 ? '' : 's'} on "${s.label}"`
        : `UX review flagged "${s.label}"`
  const sections = [
    `Screen: ${s.path} (${s.kind})`,
    s.note ? `What the loop saw: ${s.note}` : '',
    problems.length ? `Measured problems:\n${problems.join('\n')}` : '',
    reviewerWorse.length ? `Reviewer notes:\n${reviewerWorse.join('\n')}` : '',
    s.penalty_before !== null ? `Problem score: ${s.penalty_before}${s.penalty_after !== null ? ` → ${s.penalty_after}` : ''} (lower is better)` : '',
  ].filter(Boolean)
  const hasSerious = (current?.axe ?? []).some((v) => v.impact === 'critical' || v.impact === 'serious')
  const nowIso = now.toISOString()
  return {
    project_id: projectId,
    category: 'visual',
    source: 'ux_loop',
    summary: headline.slice(0, 200),
    description: sections.join('\n\n'),
    component: s.label.slice(0, 120),
    severity: hasSerious || current?.overflowX ? 'medium' : 'low',
    status: 'classified',
    confidence: 1,
    bug_ontology_tags: ['ux_loop'],
    reporter_token_hash: UX_LOOP_REPORTER,
    environment: { source: 'ux-loop', uxRunId: runId, surfaceKey: s.surface_key, url: s.path, timestamp: nowIso },
  }
}

/** Status counts for the run header. */
export function countStatuses(statuses: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const st of statuses) out[st] = (out[st] ?? 0) + 1
  return out
}

export interface CheckRunLike {
  name: string
  status: string
  conclusion: string | null
  html_url?: string | null
  started_at?: string | null
}

export interface PrChecks {
  required: string[]
  items: Array<{ name: string; status: string; conclusion: string | null; url: string | null; required: boolean }>
  /** Every required check succeeded (or, with none required, every check that ran). */
  passing: boolean
  pending: number
  failing: number
}

const GOOD = new Set(['success', 'neutral', 'skipped'])

/**
 * Pure: a PR's checks for the console's merge button. Required checks come from
 * the base branch's rules; a required check that has not reported yet counts as
 * pending, since GitHub will refuse the merge until it does. The newest run of
 * each name wins (re-runs report again under the same name).
 */
export function summarizeChecks(required: readonly string[], runs: readonly CheckRunLike[]): PrChecks {
  const latest = new Map<string, CheckRunLike>()
  for (const r of runs) {
    const seen = latest.get(r.name)
    if (!seen || (r.started_at ?? '') > (seen.started_at ?? '')) latest.set(r.name, r)
  }
  const req = new Set(required)
  const items = [...latest.values()].map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    url: r.html_url ?? null,
    required: req.has(r.name),
  }))
  for (const name of req) if (!latest.has(name)) items.push({ name, status: 'expected', conclusion: null, url: null, required: true })
  const gate = req.size > 0 ? items.filter((i) => i.required) : items
  const pending = gate.filter((i) => i.status !== 'completed').length
  const failing = gate.filter((i) => i.status === 'completed' && !GOOD.has(i.conclusion ?? '')).length
  return { required: [...req], items, passing: pending === 0 && failing === 0, pending, failing }
}
