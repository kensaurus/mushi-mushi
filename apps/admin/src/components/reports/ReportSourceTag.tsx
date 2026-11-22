/**
 * FILE: apps/admin/src/components/reports/ReportSourceTag.tsx
 * PURPOSE: One small tag naming where a bug came from (lib/reportSourceKind.ts),
 *          with a glyph so it never relies on colour. Dense: a 2xs label with
 *          a hairline border, the same weight as the row's other chips.
 */

import { REPORT_SOURCE_META, reportSourceKind } from '../../lib/reportSourceKind'

export function ReportSourceTag({ report, className = '' }: { report: { source?: string | null; metadata_source?: string | null }; className?: string }) {
  const kind = reportSourceKind(report)
  const meta = REPORT_SOURCE_META[kind]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border border-edge-subtle px-1 py-px text-2xs font-medium leading-tight ${meta.tone} ${className}`}
      title={meta.hint}
      data-testid="report-source-tag"
      data-source-kind={kind}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  )
}
