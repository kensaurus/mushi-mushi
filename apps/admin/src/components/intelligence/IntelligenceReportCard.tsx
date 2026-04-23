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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-2xs">
        <Stat label="Reports" value={report.stats?.reports?.total?.toString() ?? '—'} />
        <Stat label="Fix attempts" value={report.stats?.fixes?.total?.toString() ?? '—'} />
        <div title="Share of fix attempts that finished without errors this week. Higher is healthier.">
          <div className="text-fg-faint">Completion</div>
          <div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-fg-faint">{label}</div>
      <div className="text-fg font-mono tabular-nums">{value}</div>
    </div>
  )
}
