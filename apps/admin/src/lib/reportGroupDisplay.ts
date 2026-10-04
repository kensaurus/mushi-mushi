/**
 * FILE: apps/admin/src/lib/reportGroupDisplay.ts
 * PURPOSE: What a report group is called and how severe it is, from the
 *          columns `report_groups` actually has (`title`,
 *          `canonical_report_id`) plus its embedded reports. The panel used
 *          to read `representative_*` fields that do not exist, so every row
 *          said "(no summary)" and the merge picker listed raw UUIDs.
 */

export interface ReportGroupLike {
  id: string
  title?: string | null
  canonical_report_id?: string | null
  reports?: Array<{ id: string; summary: string | null; severity: string | null; category?: string | null }>
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

function canonical(g: ReportGroupLike) {
  const reports = g.reports ?? []
  return reports.find((r) => r.id === g.canonical_report_id) ?? reports[0] ?? null
}

/** Group title, else its canonical report's summary, else a short readable fallback. */
export function reportGroupLabel(g: ReportGroupLike): string {
  const title = g.title?.trim()
  if (title) return title
  const summary = canonical(g)?.summary?.trim()
  if (summary) return summary
  return `Untitled group (${g.reports?.length ?? 0} reports)`
}

/** Worst severity among the group's reports, or null when none is set. */
export function reportGroupSeverity(g: ReportGroupLike): string | null {
  const severities = new Set((g.reports ?? []).map((r) => r.severity).filter(Boolean) as string[])
  return SEVERITY_ORDER.find((s) => severities.has(s)) ?? null
}

export function reportGroupCategory(g: ReportGroupLike): string | null {
  return canonical(g)?.category ?? null
}
