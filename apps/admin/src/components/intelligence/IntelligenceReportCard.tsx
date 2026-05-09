/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceReportCard.tsx
 * PURPOSE: Single weekly report card. Stats strip + collapsible markdown
 *          summary + PDF download. Pure presentation.
 */

import { Card, Btn, Pct } from '../ui'
import type { IntelligenceReport } from './types'

interface Props {
  report: IntelligenceReport
  onDownload: () => void
}

export function IntelligenceReportCard({ report, onDownload }: Props) {
  const completionRate = report.stats?.fixes?.completionRate
  const completionPct = completionRate != null ? completionRate * 100 : null
  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-medium text-fg">Week of {report.week_start}</span>
          <span className="text-2xs text-fg-faint">{report.generated_by}</span>
          {report.benchmarks?.optedIn && (
            <span className="text-2xs text-ok">benchmarks ✓</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Btn size="sm" variant="ghost" onClick={onDownload}>
            Download PDF
          </Btn>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 rounded-md border border-edge-subtle/55 bg-surface-overlay/25 p-2">
        <Stat label="Reports" value={report.stats?.reports?.total?.toLocaleString() ?? '—'} />
        <Stat label="Fix attempts" value={report.stats?.fixes?.total?.toLocaleString() ?? '—'} />
        <div
          className="md:border-l md:border-edge-subtle/45 md:pl-2"
          title="Share of fix attempts that finished without errors this week. Higher is healthier."
        >
          <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Completion</div>
          <div className="mt-0.5 font-mono tabular-nums">
            <Pct value={completionPct} precision={0} direction="higher-better" />
          </div>
        </div>
        <Stat
          divider
          label="Avg fix"
          value={
            report.stats?.fixes?.avgDurationSeconds != null && report.stats.fixes.avgDurationSeconds > 0
              ? `${(report.stats.fixes.avgDurationSeconds / 60).toFixed(1)} min`
              : '—'
          }
        />
      </div>

      <details className="group">
        <summary className="cursor-pointer text-2xs text-fg-muted hover:text-fg-secondary">
          Read summary
        </summary>
        <div className="mt-2 p-2 rounded-sm bg-surface-raised/50 border border-edge-subtle text-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">
          {report.summary_md}
        </div>
      </details>
    </Card>
  )
}

function Stat({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <div className={divider ? 'md:border-l md:border-edge-subtle/45 md:pl-2' : undefined}>
      <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-0.5 text-sm text-fg font-mono tabular-nums">{value}</div>
    </div>
  )
}
