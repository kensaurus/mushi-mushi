/**
 * FILE: apps/admin/src/components/report-detail/summaryPlace.ts
 * PURPOSE: Where the report's one-line summary shows on the report page.
 *
 * Fresh-eyes sweep 2026-11-18: one summary sentence appeared five times (the
 * page title, the Classification card, story step 1, the diagnosis graph and
 * the LLM summary box). It shows once:
 *   - 'hero'           with no Stage-2 title, the page heading is the summary;
 *   - 'diagnosis'      with a title but no Stage-2 diagnosis, the diagnosis
 *                      card at the top says it;
 *   - 'classification' with a title and a Stage-2 diagnosis (whose root cause
 *                      leads the top card), the LLM classification card keeps it.
 * The story's first step never repeats it.
 */

import { reportDiagnosisView } from '../../lib/reportDiagnosis'
import type { ReportDetail } from './types'

export type SummaryPlace = 'hero' | 'diagnosis' | 'classification'

export function summaryPlace(report: ReportDetail): SummaryPlace {
  if (!report.title?.trim()) return 'hero'
  const view = reportDiagnosisView(report)
  return view.kind === 'full' || view.kind === 'streaming' ? 'classification' : 'diagnosis'
}
