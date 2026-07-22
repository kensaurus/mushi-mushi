/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceReportCard.tsx
 * PURPOSE: Single weekly report card with stats strip + collapsible summary.
 */

import { Card, Btn, Badge, Pct, RelativeTime } from '../ui'
import type { IntelligenceReport } from './types'

interface Props {
  report: IntelligenceReport
  onDownload: () => void
}

export function IntelligenceReportCard({ report, onDownload }: Props) {
  const completionRate = report.stats?.fixes?.completionRate
  const completionPct = completionRate != null ? completionRate * 100 : null
  const topCategory = topEntry(report.stats?.reports?.byCategory)
  const topSeverity = topEntry(report.stats?.reports?.bySeverity)

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">Week of {report.week_start}</span>
          <Badge className="bg-surface-raised text-fg-secondary">{report.generated_by}</Badge>
          {report.benchmarks?.optedIn && (
            <Badge tone="okSubtle">Benchmarks</Badge>
          )}
          <span className="text-2xs text-fg-faint">
            Generated <RelativeTime value={report.created_at} />
          </span>
        </div>
        <Btn size="sm" variant="ghost" onClick={onDownload}>
          Open / Print PDF
        </Btn>
      </div>

      {/* mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile) */}
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-edge-subtle bg-surface-raised/25 p-2 sm:grid-cols-4">
        <Stat label="Reports" value={report.stats?.reports?.total?.toLocaleString() ?? '—'} />
        <Stat label="Fix attempts" value={report.stats?.fixes?.total?.toLocaleString() ?? '—'} />
        <div title="Share of fix attempts that finished without errors this week.">
          <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Completion</div>
          <div className="mt-0.5 font-mono tabular-nums">
            <Pct value={completionPct} precision={0} direction="higher-better" />
          </div>
        </div>
        <Stat
          label="Avg fix"
          value={
            report.stats?.fixes?.avgDurationSeconds != null && report.stats.fixes.avgDurationSeconds > 0
              ? `${(report.stats.fixes.avgDurationSeconds / 60).toFixed(1)} min`
              : '—'
          }
        />
      </div>

      {(topCategory || topSeverity || report.llm_model) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {topCategory && (
            <Badge tone="infoSubtle">Top category: {topCategory}</Badge>
          )}
          {topSeverity && (
            <Badge tone="warnSubtle">Top severity: {topSeverity}</Badge>
          )}
          {report.llm_model && (
            <span className="font-mono text-3xs text-fg-faint">{report.llm_model}</span>
          )}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-2xs text-fg-muted hover:text-fg-secondary">
          Read AI summary
        </summary>
        <Card  className="mt-2 whitespace-pre-wrap p-3 text-xs leading-relaxed text-fg-secondary">
          {report.summary_md || 'No summary text was captured for this report.'}
        </Card>
      </details>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-fg">{value}</div>
    </div>
  )
}

function topEntry(map: Record<string, number> | undefined): string | null {
  if (!map) return null
  const entries = Object.entries(map).filter(([, v]) => v > 0)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1])
  return entries[0]?.[0] ?? null
}
