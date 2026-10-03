/**
 * FILE: packages/server/supabase/functions/_shared/design-actions.ts
 * PURPOSE: What a deviance score may do on its own, per project and off by
 *          default (project_settings, migration 20261003110000):
 *            - design_deviance_fail_ci: `mushi recipe check --push` exits
 *              non-zero when the score is above design_deviance_threshold;
 *            - design_drift_autofix: when the score is above the threshold and
 *              a scan finds warn/error findings that were not in the previous
 *              scan, open (or reuse) one design-drift report and dispatch a fix
 *              through dispatchFixForReport with trigger 'automatic', so the
 *              project's auto-fix caps (autofix_enabled, spend, dispatches per
 *              day) apply exactly as for any other automatic fix.
 *
 * Both the server scan (design-plane.ts executeScan) and the CI push
 * (POST /v1/ingest/recipe) call actOnDesignDeviance, so the two paths act the
 * same way. A first scan is a baseline: with no previous scan nothing is new.
 */

import type { getServiceClient } from './db.ts'
import { dispatchFixForReport, type DispatchResult } from './dispatch.ts'
import { log } from './logger.ts'
import type { DevianceFinding, FindingSeverity } from './design-engine-types.ts'
import { SCAN_LIMITS } from './design-scan.ts'

type Db = ReturnType<typeof getServiceClient>
const alog = log.child('design-actions')

/**
 * The phase of a design_drift run that is the app's design state (a server
 * scan or a default-branch CI push from a trusted key): the shown score, the
 * metric and the auto-fix baseline come only from these. Every reader filters
 * on it in SQL (DESIGN_PHASE_PATH), so refresh errors and PR pushes can never
 * push the latest scan out of a fixed read window.
 */
export const DESIGN_SCAN_PHASE = 'scan'
/** PostgREST path of a design_drift run's phase, for `.eq(DESIGN_PHASE_PATH, DESIGN_SCAN_PHASE)`. */
export const DESIGN_PHASE_PATH = 'summary->>phase'

export const DEFAULT_DEVIANCE_THRESHOLD = 40
/** Marks the one open report the design-drift auto-fix keeps reusing. */
export const DESIGN_DRIFT_REPORTER = 'cron:design-drift'
const OPEN_STATUSES_EXCLUDED = ['fixed', 'dismissed', 'resolved', 'verified']
const MAX_LISTED_FINDINGS = 20

export interface DesignActionSettings {
  threshold: number
  failCi: boolean
  autofix: boolean
  /** The project's own auto-fix switch; the design auto-fix goes through it. */
  autofixEnabled: boolean
}

export type SettingsRead = { ok: true; settings: DesignActionSettings } | { ok: false; error: string }

export async function loadDesignActionSettings(db: Db, projectId: string): Promise<SettingsRead> {
  const { data, error } = await db
    .from('project_settings')
    .select('design_deviance_threshold, design_deviance_fail_ci, design_drift_autofix, autofix_enabled')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  const row = (data ?? {}) as Record<string, unknown>
  const threshold = typeof row.design_deviance_threshold === 'number' ? row.design_deviance_threshold : DEFAULT_DEVIANCE_THRESHOLD
  return {
    ok: true,
    settings: {
      threshold,
      failCi: row.design_deviance_fail_ci === true,
      autofix: row.design_drift_autofix === true,
      autofixEnabled: row.autofix_enabled === true,
    },
  }
}

/** The CI gate for one score. A null score (nothing judged) never fails. */
export interface DevianceGate {
  enabled: boolean
  /** The score above which the check fails; null when the gate is off. */
  failAbove: number | null
  exceeded: boolean
}

export function devianceGate(settings: DesignActionSettings | null, score: number | null): DevianceGate {
  if (!settings?.failCi) return { enabled: false, failAbove: null, exceeded: false }
  return { enabled: true, failAbove: settings.threshold, exceeded: score !== null && score > settings.threshold }
}

type KeyedFinding = Pick<DevianceFinding, 'rule_id' | 'file_path' | 'value'>

/** Same rule, file and value; the line is left out so moving code never makes a finding "new". */
export function findingKey(f: KeyedFinding): string {
  return `${f.rule_id}|${f.file_path ?? ''}|${f.value}`
}

/**
 * Where an incomplete previous scan stops being complete. Findings are stored
 * in sortFindings order (severity, file, line) and capped, so every finding
 * whose (severity, file) sorts before the last stored one's was stored; the
 * last stored bucket and everything after it may have been cut off.
 */
export interface StoredBoundary {
  severity: FindingSeverity
  file: string
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warn: 1, info: 2 }

function bucketCompare(a: { severity: FindingSeverity; file: string }, b: StoredBoundary): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file)
}

/** The last stored (severity, file) bucket of a capped scan's stored rows; null when nothing was stored. */
export function storedBoundary(rows: readonly { severity: FindingSeverity; file_path: string | null }[]): StoredBoundary | null {
  let last: StoredBoundary | null = null
  for (const r of rows) {
    const b = { severity: r.severity, file: r.file_path ?? '' }
    if (!last || bucketCompare(b, last) > 0) last = b
  }
  return last
}

/**
 * warn/error findings of this scan whose key the previous scan did not have.
 * With a boundary (the previous scan stored only part of its findings), only
 * findings in buckets the previous scan stored completely can be judged new:
 * one past its cap may simply not have been stored.
 */
export function newFindings<T extends KeyedFinding & { severity: FindingSeverity }>(current: readonly T[], previous: readonly KeyedFinding[], boundary: StoredBoundary | null = null): T[] {
  const before = new Set(previous.map(findingKey))
  const seen = new Set<string>()
  return current.filter((f) => {
    if (f.severity === 'info') return false
    if (boundary && bucketCompare({ severity: f.severity, file: f.file_path ?? '' }, boundary) >= 0) return false
    const k = findingKey(f)
    if (before.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The report text a fixing agent reads: each new finding with the token to use instead. */
export function driftReportText(found: readonly DevianceFinding[], score: number, branch: string | null): { summary: string; description: string } {
  const n = found.length
  const lines = found.slice(0, MAX_LISTED_FINDINGS).map((f) => {
    const at = f.file_path ? `${f.file_path}${f.line ? `:${f.line}` : ''}` : 'tokens'
    const use = f.suggestion ? ` Use ${f.suggestion.cssVar ?? f.suggestion.ts ?? f.suggestion.token} (${f.suggestion.value}).` : ''
    return `- ${at} — ${f.message}${use}`
  })
  const more = n > MAX_LISTED_FINDINGS ? `\n- … and ${n - MAX_LISTED_FINDINGS} more in the latest design_drift scan.` : ''
  return {
    summary: `Design drift: ${n} new value${n === 1 ? '' : 's'} off the design system (score ${score}/100)`,
    description: [
      `[Design drift] The latest deviance scan${branch ? ` of ${branch}` : ''} found ${n} value${n === 1 ? '' : 's'} that ${n === 1 ? 'is' : 'are'} not in this app's design tokens and ${n === 1 ? 'was' : 'were'} not there in the previous scan.`,
      '',
      ...lines,
      more,
      '',
      'Replace each value with the suggested token (or the closest one in mushi.recipe.json\'s token files). Change only these values; keep behaviour and layout the same.',
    ].filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n').trim(),
  }
}

export interface ActInput {
  projectId: string
  runId: string
  score: number | null
  /**
   * This scan's STORED findings (storedFindingsOf), never the uncapped list:
   * the previous scan is read back from its stored rows, so a finding past the
   * cap would otherwise look new on every scan.
   */
  findings: readonly DevianceFinding[]
  branch: string | null
}

export type ActOutcome =
  | { action: 'off' | 'below_threshold' | 'baseline' | 'no_new_findings' | 'not_default_branch' }
  | { action: 'autofix_disabled' }
  /** The CI push came with a key a web page has sent (public): it may not dispatch or set the baseline. */
  | { action: 'key_not_trusted'; reason: 'browser_request' | 'key_seen_in_browser' }
  | { action: 'settings_unavailable' | 'report_failed'; error: string }
  | { action: 'dispatched'; reportId: string; dispatchId: string | null; newFindings: number }
  | { action: 'dispatch_refused'; reportId: string; code: DispatchResult['code']; message: string | undefined }

export interface ActDeps {
  dispatch: typeof dispatchFixForReport
  now: () => Date
}

const defaultActDeps: ActDeps = { dispatch: dispatchFixForReport, now: () => new Date() }

/** The findings a scan keeps (and acts on): the first SCAN_LIMITS.maxStoredFindings in sortFindings order. */
export function storedFindingsOf<T>(findings: readonly T[]): T[] {
  return findings.slice(0, SCAN_LIMITS.maxStoredFindings)
}

interface PreviousScan {
  findings: KeyedFinding[]
  /** Set when the previous scan stored fewer findings than it found. */
  boundary: StoredBoundary | null
}

/**
 * The newest completed scan other than `runId`, filtered in SQL (phase and
 * status), so any number of refresh errors or PR pushes in between can never
 * hide it. Null when there is none (this scan is the baseline).
 */
async function previousScan(db: Db, projectId: string, runId: string): Promise<PreviousScan | null> {
  const { data: runs, error } = await db
    .from('gate_runs')
    .select('id, findings_count, summary')
    .eq('project_id', projectId)
    .eq('gate', 'design_drift')
    .eq(DESIGN_PHASE_PATH, DESIGN_SCAN_PHASE)
    .in('status', ['pass', 'warn', 'fail'])
    .neq('id', runId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`gate_runs read failed: ${error.message}`)
  const prev = ((runs ?? []) as Array<{ id: string; findings_count: number | null; summary: { storedFindings?: unknown } | null }>)[0]
  if (!prev) return null
  const { data: rows, error: fErr } = await db
    .from('gate_findings')
    .select('rule_id, severity, file_path, suggested_fix')
    .eq('gate_run_id', prev.id)
    .limit(SCAN_LIMITS.maxStoredFindings * 2)
  if (fErr) throw new Error(`gate_findings read failed: ${fErr.message}`)
  const stored = (rows ?? []) as Array<{ rule_id: string; severity: FindingSeverity; file_path: string | null; suggested_fix: { value?: string } | null }>
  const storedCount = typeof prev.summary?.storedFindings === 'number' ? prev.summary.storedFindings : stored.length
  const found = typeof prev.findings_count === 'number' ? prev.findings_count : storedCount
  return {
    findings: stored.map((r) => ({ rule_id: r.rule_id as DevianceFinding['rule_id'], file_path: r.file_path, value: r.suggested_fix?.value ?? '' })),
    // Nothing stored of a capped scan: no bucket is known complete, so nothing can be new.
    boundary: found > storedCount ? storedBoundary(stored) ?? { severity: 'error', file: '' } : null,
  }
}

/** One open design-drift report per project: reuse it (with fresh text) or open it. */
async function upsertDriftReport(db: Db, projectId: string, text: { summary: string; description: string }, severity: 'medium' | 'low', runId: string, now: Date): Promise<string> {
  const { data: open, error: readErr } = await db
    .from('reports')
    .select('id, status')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', DESIGN_DRIFT_REPORTER)
    .not('status', 'in', `(${OPEN_STATUSES_EXCLUDED.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(1)
  if (readErr) throw new Error(`reports read failed: ${readErr.message}`)
  const existing = ((open ?? []) as Array<{ id: string }>)[0]
  const environment = { source: 'design-drift', gateRunId: runId }
  if (existing) {
    const { error } = await db
      .from('reports')
      .update({ summary: text.summary, description: text.description, severity, environment, updated_at: now.toISOString() })
      .eq('id', existing.id)
    if (error) throw new Error(`report update failed: ${error.message}`)
    return existing.id
  }
  const { data, error } = await db
    .from('reports')
    .insert({
      project_id: projectId,
      category: 'visual',
      source: 'api',
      description: text.description,
      summary: text.summary,
      component: 'design system',
      severity,
      status: 'classified',
      confidence: 1,
      bug_ontology_tags: ['design_drift'],
      reporter_token_hash: DESIGN_DRIFT_REPORTER,
      environment,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`report insert failed: ${error?.message ?? 'no row returned'}`)
  return (data as { id: string }).id
}

/**
 * Act on one finished deviance scan. Never throws: every outcome, including a
 * failed read or insert, comes back as an ActOutcome for the caller to log
 * and return, so a broken action is visible instead of silently absent.
 */
export async function actOnDesignDeviance(db: Db, input: ActInput, settings: SettingsRead | null = null, deps: ActDeps = defaultActDeps): Promise<ActOutcome> {
  const read = settings ?? (await loadDesignActionSettings(db, input.projectId))
  if (!read.ok) return { action: 'settings_unavailable', error: read.error }
  const s = read.settings
  if (!s.autofix) return { action: 'off' }
  if (input.score === null || input.score <= s.threshold) return { action: 'below_threshold' }
  if (!s.autofixEnabled) return { action: 'autofix_disabled' }
  try {
    const previous = await previousScan(db, input.projectId, input.runId)
    if (previous === null) return { action: 'baseline' }
    const fresh = newFindings(storedFindingsOf(input.findings), previous.findings, previous.boundary)
    if (fresh.length === 0) return { action: 'no_new_findings' }
    const text = driftReportText(fresh, input.score, input.branch)
    const severity = fresh.some((f) => f.severity === 'error') ? 'medium' : 'low'
    const reportId = await upsertDriftReport(db, input.projectId, text, severity, input.runId, deps.now())
    const res = await deps.dispatch({
      projectId: input.projectId,
      reportId,
      skipMembershipCheck: true,
      trigger: 'automatic',
      metadata: { source: 'design_drift', gateRunId: input.runId, score: input.score, newFindings: fresh.length },
    })
    if (!res.ok) return { action: 'dispatch_refused', reportId, code: res.code, message: res.message }
    return { action: 'dispatched', reportId, dispatchId: res.dispatchId ?? null, newFindings: fresh.length }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    alog.error('design drift auto-fix failed', { projectId: input.projectId, runId: input.runId, err: message })
    return { action: 'report_failed', error: message }
  }
}
