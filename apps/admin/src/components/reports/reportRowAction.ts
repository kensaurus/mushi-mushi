/**
 * FILE: apps/admin/src/components/reports/reportRowAction.ts
 * PURPOSE: The row action for a report with nothing left to triage.
 *
 * Why (2026-10-04 console audit): fixed and dismissed rows on /reports showed
 * the same red "Triage →" as a brand-new bug, so finished work read as an
 * alarm. They now show a neutral chip that opens the report.
 */

import { CHIP_TONE } from '../../lib/chipTone'

const FIXED_STATUSES = new Set(['fixed', 'verified', 'resolved'])

/** Neutral row action for a fixed or dismissed report, else null (keep Triage / Fix). */
export function closedRowAction(status: string): { label: string; className: string } | null {
  if (FIXED_STATUSES.has(status)) return { label: 'Fixed ✓', className: `${CHIP_TONE.okSubtle} hover:opacity-90` }
  if (status === 'dismissed') return { label: 'View', className: `${CHIP_TONE.neutral} hover:text-fg` }
  return null
}
