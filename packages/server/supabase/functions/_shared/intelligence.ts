// =============================================================================
// V5.3 §2.16 B5 — bug intelligence reports + cross-customer benchmarks.
//
// Pure(-ish) helpers reused by both the scheduled `intelligence-report` cron
// and the on-demand admin endpoint. No Edge-only globals at module load so
// the helpers stay unit-testable.
// =============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface ReportStats {
  total: number
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
  byComponent: Record<string, number>
  byStatus: Record<string, number>
}

export interface FixStats {
  total: number
  completed: number
  failed: number
  completionRate: number
  avgDurationSeconds: number | null
}

export interface IntelligenceStats {
  weekStart: string  // ISO date (YYYY-MM-DD) — Monday of the reporting week.
  reports: ReportStats
  fixes: FixStats
  judgeScores: Array<Record<string, unknown>>
}

export interface BenchmarkBucket {
  weekStart: string
  category: string
  severity: string | null
  contributingProjects: number
  reportCount: number
  avgAgeDays: number | null
  avgFixCompletionRate: number | null
  avgFixSeconds: number | null
}

export interface IntelligenceBenchmarks {
  /**
   * If null, the project has not opted in OR the most recent run did not have
   * enough peer projects (k-anonymity threshold not met).
   */
  optedIn: boolean
  reason?: 'not_opted_in' | 'k_anonymity_unmet' | 'insufficient_data'
  buckets: BenchmarkBucket[]
}

export interface PersistIntelligenceReportInput {
  projectId: string
  weekStart: string
  summaryMd: string
  stats: IntelligenceStats
  benchmarks: IntelligenceBenchmarks | null
  llmModel: string
  llmTokensIn: number | null
  llmTokensOut: number | null
  generatedBy: 'cron' | 'manual' | 'http'
  renderedHtml: string
}

const TYPICAL_REPORT_FIELDS = ['category', 'severity', 'component', 'status', 'created_at'] as const

/** Compute aggregate stats for a project over a 7-day window starting at `weekStart`. */
export async function computeWeeklyStats(
  db: SupabaseClient,
  projectId: string,
  weekStart: Date,
): Promise<IntelligenceStats> {
  const start = new Date(weekStart)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [reportsRes, fixesRes, judgeRes] = await Promise.all([
    db
      .from('reports')
      .select(TYPICAL_REPORT_FIELDS.join(','))
      .eq('project_id', projectId)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .limit(2000),
    db
      .from('fix_attempts')
      .select('status, started_at, completed_at')
      .eq('project_id', projectId)
      .gte('started_at', start.toISOString())
      .lt('started_at', end.toISOString())
      .limit(1000),
    db.rpc('weekly_judge_scores', { p_project_id: projectId, p_weeks: 2 }),
  ])

  const reports = (reportsRes.data ?? []) as Array<{
    category: string
    severity: string | null
    component: string | null
    status: string
    created_at: string
  }>
  const fixes = (fixesRes.data ?? []) as Array<{
    status: string
    started_at: string | null
    completed_at: string | null
  }>

  const reportStats: ReportStats = {
    total: reports.length,
    byCategory: tally(reports, (r) => r.category),
    bySeverity: tally(reports, (r) => r.severity ?? 'unset'),
    byComponent: tally(reports, (r) => r.component ?? 'unknown'),
    byStatus: tally(reports, (r) => r.status),
  }

  const completed = fixes.filter((f) => f.status === 'completed')
  const durations = completed
    .map((f) =>
      f.started_at && f.completed_at
        ? (new Date(f.completed_at).getTime() - new Date(f.started_at).getTime()) / 1000
        : null,
    )
    .filter((v): v is number => v !== null && v > 0)

  const fixStats: FixStats = {
    total: fixes.length,
    completed: completed.length,
    failed: fixes.filter((f) => f.status === 'failed').length,
    completionRate: fixes.length > 0 ? completed.length / fixes.length : 0,
    avgDurationSeconds:
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  }

  return {
    weekStart: start.toISOString().slice(0, 10),
    reports: reportStats,
    fixes: fixStats,
    judgeScores: (judgeRes.data ?? []) as Array<Record<string, unknown>>,
  }
}

/**
 * Pull the latest cross-customer benchmarks the requesting project is allowed
 * to see. The k-anonymity threshold is enforced at the materialized view
 * level — we just gate visibility on opt-in here.
 */
export async function fetchBenchmarks(
  db: SupabaseClient,
  projectId: string,
): Promise<IntelligenceBenchmarks> {
  const { data: settings } = await db
    .from('project_settings')
    .select('benchmarking_optin')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!settings?.benchmarking_optin) {
    return { optedIn: false, reason: 'not_opted_in', buckets: [] }
  }

  const { data, error } = await db
    .from('intelligence_benchmarks_mv')
    .select('*')
    .order('week_start', { ascending: false })
    .limit(200)

  if (error || !data || data.length === 0) {
    return { optedIn: true, reason: 'insufficient_data', buckets: [] }
  }

  const buckets: BenchmarkBucket[] = data.map((row: Record<string, unknown>) => ({
    weekStart: String(row.week_start),
    category: String(row.category),
    severity: row.severity ? String(row.severity) : null,
    contributingProjects: Number(row.contributing_projects ?? 0),
    reportCount: Number(row.report_count ?? 0),
    avgAgeDays: row.avg_age_days != null ? Number(row.avg_age_days) : null,
    avgFixCompletionRate:
      row.avg_fix_completion_rate != null ? Number(row.avg_fix_completion_rate) : null,
    avgFixSeconds: row.avg_fix_seconds != null ? Number(row.avg_fix_seconds) : null,
  }))

  return { optedIn: true, buckets }
}

export async function persistIntelligenceReport(
  db: SupabaseClient,
  input: PersistIntelligenceReportInput,
): Promise<{ id: string }> {
  const { data, error } = await db
    .from('intelligence_reports')
    .upsert(
      {
        project_id: input.projectId,
        week_start: input.weekStart,
        summary_md: input.summaryMd,
        stats: input.stats,
        benchmarks: input.benchmarks,
        rendered_html: input.renderedHtml,
        llm_model: input.llmModel,
        llm_tokens_in: input.llmTokensIn,
        llm_tokens_out: input.llmTokensOut,
        generated_by: input.generatedBy,
      },
      { onConflict: 'project_id,week_start' },
    )
    .select('id')
    .single()

  if (error || !data) throw new Error(`persistIntelligenceReport failed: ${error?.message ?? 'no row returned'}`)
  return { id: data.id as string }
}

/**
 * Render the intelligence report as a self-contained, print-friendly HTML
 * document. The admin client opens this in a new window and uses the
 * browser's native print pipeline to produce a PDF — no headless-Chrome
 * dependency on the server, no extra npm packages on the client.
 *
 * We deliberately keep the styling minimal and inline (no external assets)
 * so the same HTML works whether the user prints it now or downloads the
 * file for archiving.
 */
export function renderIntelligenceHtml(args: {
  projectName: string
  weekStart: string
  summaryMd: string
  stats: IntelligenceStats
  benchmarks: IntelligenceBenchmarks | null
}): string {
  const { projectName, weekStart, summaryMd, stats, benchmarks } = args
  const safeProject = escapeHtml(projectName)
  const summary = mdLite(summaryMd)
  const reportTable = renderKvTable('Reports by Category', stats.reports.byCategory)
  const sevTable = renderKvTable('Reports by Severity', stats.reports.bySeverity)
  const compTable = renderKvTable('Top Components', topN(stats.reports.byComponent, 10))
  const fix = stats.fixes
  const fixDuration = fix.avgDurationSeconds != null ? `${(fix.avgDurationSeconds / 60).toFixed(1)} min` : '—'
  const benchmarkSection = renderBenchmarkSection(benchmarks)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Bug Intelligence — ${safeProject} — ${weekStart}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; max-width: 880px; margin: 32px auto; padding: 0 24px; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
  .summary { background: #f9fafb; border-left: 3px solid #6366f1; padding: 12px 16px; border-radius: 0 6px 6px 0; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .stat { background: #f9fafb; border: 1px solid #e5e7eb; padding: 10px 12px; border-radius: 6px; }
  .stat .l { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat .v { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #f3f4f6; }
  th { color: #6b7280; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .bench { background: #fffbeb; border: 1px solid #fcd34d; padding: 12px; border-radius: 6px; }
  .bench.disabled { background: #f3f4f6; border-color: #e5e7eb; color: #6b7280; }
  .footer { margin-top: 32px; color: #9ca3af; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  @media print { body { margin: 0; max-width: none; } .no-print { display: none; } }
</style>
</head>
<body>
  <header>
    <h1>Bug Intelligence Report</h1>
    <div class="meta">${safeProject} &middot; week of ${weekStart}</div>
  </header>

  <div class="grid">
    <div class="stat"><div class="l">Reports</div><div class="v">${stats.reports.total}</div></div>
    <div class="stat"><div class="l">Fix attempts</div><div class="v">${fix.total}</div></div>
    <div class="stat"><div class="l">Completion rate</div><div class="v">${(fix.completionRate * 100).toFixed(0)}%</div></div>
    <div class="stat"><div class="l">Avg fix time</div><div class="v">${fixDuration}</div></div>
  </div>

  <h2>Executive Summary</h2>
  <div class="summary">${summary}</div>

  ${reportTable}
  ${sevTable}
  ${compTable}

  <h2>Cross-Customer Benchmarks</h2>
  ${benchmarkSection}

  <div class="footer">
    Generated by Mushi Mushi · ${new Date().toISOString()} · §2.16 V5.3 intelligence pipeline
  </div>
</body>
</html>`
}

// ─── helpers ──────────────────────────────────────────────────────────────

function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const k = key(r)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function topN(map: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Tiny markdown renderer covering the subset the LLM digest actually emits:
 * paragraphs, bold, italic, inline code, bullet lists, and headings.
 * Keeping it inline (rather than pulling a markdown lib into Deno) avoids a
 * new runtime dependency for one consumer.
 */
function mdLite(md: string): string {
  const escaped = escapeHtml(md.trim())
  const lines = escaped.split(/\r?\n/)
  const html: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (inList) {
        html.push('</ul>')
        inList = false
      }
      html.push('')
      continue
    }
    if (/^- /.test(line)) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inline(line.slice(2))}</li>`)
      continue
    }
    if (inList) {
      html.push('</ul>')
      inList = false
    }
    if (/^### /.test(line)) html.push(`<h4>${inline(line.slice(4))}</h4>`)
    else if (/^## /.test(line)) html.push(`<h3>${inline(line.slice(3))}</h3>`)
    else if (/^# /.test(line)) html.push(`<h2>${inline(line.slice(2))}</h2>`)
    else html.push(`<p>${inline(line)}</p>`)
  }
  if (inList) html.push('</ul>')
  return html.join('\n')
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderKvTable(title: string, map: Record<string, number>): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return ''
  const rows = entries
    .map(
      ([k, v]) =>
        `<tr><td>${escapeHtml(k)}</td><td class="num">${v.toLocaleString()}</td></tr>`,
    )
    .join('')
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr><th>Bucket</th><th class="num">Count</th></tr></thead><tbody>${rows}</tbody></table>`
}

function renderBenchmarkSection(b: IntelligenceBenchmarks | null): string {
  if (!b || !b.optedIn) {
    return `<div class="bench disabled">Cross-customer benchmarks are <strong>opt-in</strong>. Enable them in Settings → Privacy to see how this project compares to anonymised aggregates from other Mushi Mushi tenants. We require at least 5 contributing projects per bucket (k-anonymity).</div>`
  }
  if (b.buckets.length === 0) {
    return `<div class="bench">You are opted in, but no benchmark bucket currently meets the k-anonymity threshold (≥ 5 contributing projects). Buckets will populate as more projects opt in.</div>`
  }
  const top = b.buckets.slice(0, 12)
  const rows = top
    .map(
      (bucket) =>
        `<tr>
          <td>${escapeHtml(bucket.weekStart)}</td>
          <td>${escapeHtml(bucket.category)}</td>
          <td>${escapeHtml(bucket.severity ?? '—')}</td>
          <td class="num">${bucket.contributingProjects}</td>
          <td class="num">${bucket.reportCount.toLocaleString()}</td>
          <td class="num">${bucket.avgFixCompletionRate != null ? (bucket.avgFixCompletionRate * 100).toFixed(0) + '%' : '—'}</td>
        </tr>`,
    )
    .join('')
  return `<table><thead><tr><th>Week</th><th>Category</th><th>Severity</th><th class="num">Projects</th><th class="num">Reports</th><th class="num">Fix rate</th></tr></thead><tbody>${rows}</tbody></table>`
}
