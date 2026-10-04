/**
 * FILE: packages/server/supabase/functions/_shared/fix-report-truth-load.ts
 * PURPOSE: Load what `deriveReportFixTruths` needs for a set of reports:
 *          the report rows, EVERY attempt on those reports (not just the
 *          ones inside a count window — a merged sibling outside the window
 *          still fixes the report), and which AI providers have a working
 *          key on file now.
 *
 * Callers pick the report ids (usually the reports touched by attempts in
 * their window) and then count with `summarizeFixTruths`.
 */

import {
  deriveReportFixTruths,
  type ReportFixTruth,
  type TruthAttempt,
  type TruthReport,
} from './fix-report-truth.ts'

/** Columns every truth derivation needs from fix_attempts. */
export const TRUTH_ATTEMPT_COLUMNS =
  'id, report_id, project_id, status, pr_url, pr_number, pr_state, merged_at, check_run_conclusion, failure_category, error, created_at, started_at'

const ID_CHUNK = 100

/**
 * One window for every fix count: a report is counted when it had a fix
 * attempt in the last 30 days (UTC, today included). The dashboard, /inbox,
 * /fixes, nav badges and project rows all pick their reports through
 * `loadRecentFixTruths`, so a report never ages out of one surface while
 * another still counts it.
 */
export const FIX_TRUTH_WINDOW_DAYS = 30

export function fixTruthWindowStart(now: Date = new Date()): string {
  const since = new Date(now)
  since.setUTCDate(since.getUTCDate() - (FIX_TRUTH_WINDOW_DAYS - 1))
  since.setUTCHours(0, 0, 0, 0)
  return since.toISOString()
}

// Structural type: the Supabase builder is awaited after `.in()` (or after a
// trailing `.limit()`), which keeps this module free of the client import.
type QueryResult = PromiseLike<{ data: unknown[] | null; error?: unknown }>
interface TruthDb {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => QueryResult & {
        limit: (n: number) => QueryResult
        gte: (col: string, value: string) => {
          order: (col: string, opts: { ascending: boolean }) => { limit: (n: number) => QueryResult }
        }
      }
    }
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export interface ReportTitleRow {
  id: string
  project_id?: string | null
  status?: string | null
  summary?: string | null
  description?: string | null
}

/** Plain-English title for a report: its summary, else the start of its description. */
export function reportTitle(row: Pick<ReportTitleRow, 'summary' | 'description'> | null | undefined): string | null {
  const summary = row?.summary?.trim()
  if (summary) return summary
  const desc = row?.description?.trim()
  return desc ? desc.slice(0, 80) + (desc.length > 80 ? '…' : '') : null
}

export interface LoadedFixTruths {
  truths: Map<string, ReportFixTruth>
  reports: Map<string, ReportTitleRow>
  attemptsByReport: Map<string, Array<TruthAttempt & { project_id?: string }>>
}

export async function loadReportFixTruths(
  db: TruthDb,
  reportIds: Iterable<string>,
): Promise<LoadedFixTruths> {
  const ids = [...new Set(reportIds)].filter(Boolean)
  const reports = new Map<string, ReportTitleRow>()
  const attempts: Array<TruthAttempt & { project_id?: string }> = []
  if (ids.length === 0) {
    return { truths: new Map(), reports, attemptsByReport: new Map() }
  }

  await Promise.all(
    chunk(ids, ID_CHUNK).map(async (part) => {
      const [repRes, attRes] = await Promise.all([
        db.from('reports').select('id, project_id, status, summary, description').in('id', part),
        db.from('fix_attempts').select(TRUTH_ATTEMPT_COLUMNS).in('report_id', part).limit(2000),
      ])
      for (const r of (repRes.data ?? []) as ReportTitleRow[]) reports.set(r.id, r)
      for (const a of (attRes.data ?? []) as Array<TruthAttempt & { project_id?: string }>) attempts.push(a)
    }),
  )

  const projectIds = [...new Set([...reports.values()].map((r) => r.project_id).filter(Boolean) as string[])]
  const healthyByProject = new Map<string, Set<string>>()
  const checkedByProject = new Map<string, Set<string>>()
  if (projectIds.length > 0) {
    const { data: keyRows } = await db
      .from('byok_keys')
      .select('project_id, provider_slug, status, test_status')
      .in('project_id', projectIds)
    for (const k of (keyRows ?? []) as Array<{
      project_id: string
      provider_slug: string
      status?: string | null
      test_status?: string | null
    }>) {
      const checked = checkedByProject.get(k.project_id) ?? new Set<string>()
      checked.add(k.provider_slug)
      checkedByProject.set(k.project_id, checked)
      if (k.status === 'active' && k.test_status === 'ok') {
        const healthy = healthyByProject.get(k.project_id) ?? new Set<string>()
        healthy.add(k.provider_slug)
        healthyByProject.set(k.project_id, healthy)
      }
    }
  }

  // Derive per project so one project's healthy key never clears another's.
  const truths = new Map<string, ReportFixTruth>()
  const attemptsByReport = new Map<string, Array<TruthAttempt & { project_id?: string }>>()
  for (const a of attempts) {
    const list = attemptsByReport.get(a.report_id)
    if (list) list.push(a)
    else attemptsByReport.set(a.report_id, [a])
  }
  const byProject = new Map<string, Array<TruthAttempt & { project_id?: string }>>()
  for (const a of attempts) {
    const pid = reports.get(a.report_id)?.project_id ?? a.project_id ?? ''
    const list = byProject.get(pid)
    if (list) list.push(a)
    else byProject.set(pid, [a])
  }
  const reportsById = new Map<string, TruthReport>([...reports.entries()])
  for (const [pid, list] of byProject) {
    const derived = deriveReportFixTruths({
      attempts: list,
      reportsById,
      healthyKeyProviders: healthyByProject.get(pid),
      checkedKeyProviders: checkedByProject.get(pid),
    })
    for (const [rid, t] of derived) truths.set(rid, t)
  }
  return { truths, reports, attemptsByReport }
}

/**
 * The fix truth for every report with an attempt in the shared window, in
 * the given projects. Use this for any fix count shown to a user.
 */
export async function loadRecentFixTruths(
  db: TruthDb,
  projectIds: string[],
  now: Date = new Date(),
): Promise<LoadedFixTruths> {
  if (projectIds.length === 0) {
    return { truths: new Map(), reports: new Map(), attemptsByReport: new Map() }
  }
  const { data } = await db
    .from('fix_attempts')
    .select('report_id')
    .in('project_id', projectIds)
    .gte('created_at', fixTruthWindowStart(now))
    .order('created_at', { ascending: false })
    .limit(2000)
  const ids = ((data ?? []) as Array<{ report_id: string }>).map((r) => r.report_id)
  return loadReportFixTruths(db, ids)
}

export interface FailedFixPreview {
  id: string
  report_id: string
  error_head: string | null
  report_title: string | null
}

/**
 * The newest failing attempt of each `failed` report, newest first —
 * the "what needs attention" preview on the dashboard and project rows.
 */
export function failedFixPreviews(
  loaded: LoadedFixTruths,
  opts: { projectId?: string; limit?: number } = {},
): FailedFixPreview[] {
  const rows: Array<FailedFixPreview & { at: number }> = []
  for (const t of loaded.truths.values()) {
    if (t.state !== 'failed' || !t.latestAttemptId) continue
    const report = loaded.reports.get(t.reportId)
    if (opts.projectId && report?.project_id !== opts.projectId) continue
    const attempt = loaded.attemptsByReport.get(t.reportId)?.find((a) => a.id === t.latestAttemptId)
    rows.push({
      id: t.latestAttemptId,
      report_id: t.reportId,
      error_head: attempt?.error ? attempt.error.split('\n')[0].slice(0, 160) : null,
      report_title: reportTitle(report),
      at: Date.parse(attempt?.created_at ?? '') || 0,
    })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows.slice(0, opts.limit ?? 3).map(({ at: _at, ...rest }) => rest)
}
