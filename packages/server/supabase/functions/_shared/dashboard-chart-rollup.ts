/**
 * FILE: packages/server/supabase/functions/_shared/dashboard-chart-rollup.ts
 * PURPOSE: The 14-day charts on /v1/admin/dashboard: report intake per UTC day
 *          by severity, LLM calls / tokens / latency / failures per day, and
 *          the top components.
 *
 * REGRESSION (2026-10-16): the route read up to 5,000 chart rows per table and
 * bucketed them in JS, but PostgREST caps a plain select at 1,000 rows. The
 * 14-day window held 1,716 LLM invocations, so the oldest days of the LLM
 * chart and the 14-day token total came up short while `chartsSampled` still
 * said false. The buckets now come from the `dashboard_chart_rollup` SQL
 * function (migration 20261016100100). When it is not deployed yet, the old
 * row read runs and `sampled` says whether a cap was hit.
 */

import type { getServiceClient } from './db.ts'

type Db = ReturnType<typeof getServiceClient>
type ReadError = { message?: string; code?: string; details?: string | null; hint?: string | null }

export interface ReportDayBucket {
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unscored: number
}

export interface LlmDayBucket {
  calls: number
  tokens: number
  latencyMs: number
  failures: number
}

export interface DashboardCharts {
  /** Keyed by UTC day (YYYY-MM-DD). */
  reportDays: Map<string, ReportDayBucket>
  llmDays: Map<string, LlmDayBucket>
  topComponents: Array<{ component: string; count: number }>
  /** True when a row read hit its cap, so the charts are a sample. */
  sampled: boolean
  source: 'rollup' | 'rows'
}

export class DashboardChartReadError extends Error {
  constructor(
    readonly what: string,
    readonly readError: ReadError | null | undefined,
  ) {
    super(`${what}: ${readError?.message ?? 'read failed'}`)
    this.name = 'DashboardChartReadError'
  }
}

const TOP_COMPONENTS = 6

function emptyReportDay(): ReportDayBucket {
  return { total: 0, critical: 0, high: 0, medium: 0, low: 0, unscored: 0 }
}

/** Bucket raw report rows the way the route always did. */
export function bucketReportRows(
  rows: ReadonlyArray<{ created_at: string; severity: string | null; component: string | null }>,
): { days: Map<string, ReportDayBucket>; topComponents: Array<{ component: string; count: number }> } {
  const days = new Map<string, ReportDayBucket>()
  const componentCounts = new Map<string, number>()
  for (const r of rows) {
    const day = String(r.created_at).slice(0, 10)
    const bucket = days.get(day) ?? emptyReportDay()
    bucket.total++
    const sev = (r.severity ?? '').toLowerCase()
    if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') bucket[sev]++
    else bucket.unscored++
    days.set(day, bucket)
    const comp = (r.component ?? '').trim()
    if (comp) componentCounts.set(comp, (componentCounts.get(comp) ?? 0) + 1)
  }
  const topComponents = [...componentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_COMPONENTS)
    .map(([component, count]) => ({ component, count }))
  return { days, topComponents }
}

/** Bucket raw LLM invocation rows the way the route always did. */
export function bucketLlmRows(
  rows: ReadonlyArray<{
    created_at: string
    status: string | null
    latency_ms: number | null
    input_tokens: number | null
    output_tokens: number | null
  }>,
): Map<string, LlmDayBucket> {
  const days = new Map<string, LlmDayBucket>()
  for (const inv of rows) {
    const day = String(inv.created_at).slice(0, 10)
    const bucket = days.get(day) ?? { calls: 0, tokens: 0, latencyMs: 0, failures: 0 }
    bucket.calls++
    bucket.tokens += (inv.input_tokens ?? 0) + (inv.output_tokens ?? 0)
    bucket.latencyMs += inv.latency_ms ?? 0
    if (inv.status !== 'success') bucket.failures++
    days.set(day, bucket)
  }
  return days
}

interface RollupJson {
  report_days?: Array<{
    day: string
    total: number
    critical: number
    high: number
    medium: number
    low: number
    unscored: number
  }>
  llm_days?: Array<{ day: string; calls: number; tokens: number; latency_ms: number; failures: number }>
  components?: Array<{ component: string; count: number }>
}

/** The SQL function's jsonb, in the same shape as the row bucketing. */
export function chartsFromRollup(json: RollupJson): DashboardCharts {
  const reportDays = new Map<string, ReportDayBucket>()
  for (const d of json.report_days ?? []) {
    reportDays.set(String(d.day).slice(0, 10), {
      total: Number(d.total ?? 0),
      critical: Number(d.critical ?? 0),
      high: Number(d.high ?? 0),
      medium: Number(d.medium ?? 0),
      low: Number(d.low ?? 0),
      unscored: Number(d.unscored ?? 0),
    })
  }
  const llmDays = new Map<string, LlmDayBucket>()
  for (const d of json.llm_days ?? []) {
    llmDays.set(String(d.day).slice(0, 10), {
      calls: Number(d.calls ?? 0),
      tokens: Number(d.tokens ?? 0),
      latencyMs: Number(d.latency_ms ?? 0),
      failures: Number(d.failures ?? 0),
    })
  }
  const topComponents = (json.components ?? [])
    .slice(0, TOP_COMPONENTS)
    .map((c) => ({ component: String(c.component), count: Number(c.count ?? 0) }))
  return { reportDays, llmDays, topComponents, sampled: false, source: 'rollup' }
}

function isMissingFunction(err: ReadError | null): boolean {
  return err?.code === 'PGRST202' || err?.code === '42883'
}

/**
 * Chart buckets since `sinceIso`. Throws `DashboardChartReadError` on a read
 * error, so a broken read answers with an error instead of an empty chart.
 * `rowCap` bounds the fallback row read.
 */
export async function loadDashboardCharts(
  db: Db,
  projectIds: string[],
  sinceIso: string,
  rowCap: number,
): Promise<DashboardCharts> {
  const { data, error } = await db.rpc('dashboard_chart_rollup', {
    p_project_ids: projectIds,
    p_since: sinceIso,
  })
  if (!error) return chartsFromRollup((data ?? {}) as RollupJson)
  if (!isMissingFunction(error)) throw new DashboardChartReadError('dashboard chart rollup', error)

  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'dashboard_chart_rollup missing — apply migration 20261016100100; reading capped chart rows',
    }),
  )
  const [reportRes, llmRes] = await Promise.all([
    db
      .from('reports')
      .select('created_at, severity, component')
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(rowCap),
    db
      .from('llm_invocations')
      .select('created_at, status, latency_ms, input_tokens, output_tokens')
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(rowCap),
  ])
  if (reportRes.error) throw new DashboardChartReadError('report chart rows', reportRes.error)
  if (llmRes.error) throw new DashboardChartReadError('llm chart rows', llmRes.error)
  const reportRows = (reportRes.data ?? []) as Array<{ created_at: string; severity: string | null; component: string | null }>
  const llmRows = (llmRes.data ?? []) as Parameters<typeof bucketLlmRows>[0]
  const reports = bucketReportRows(reportRows)
  return {
    reportDays: reports.days,
    llmDays: bucketLlmRows(llmRows),
    topComponents: reports.topComponents,
    sampled: reportRows.length >= rowCap || llmRows.length >= rowCap,
    source: 'rows',
  }
}
