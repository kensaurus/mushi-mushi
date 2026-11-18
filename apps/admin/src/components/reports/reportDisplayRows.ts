/**
 * FILE: apps/admin/src/components/reports/reportDisplayRows.ts
 * PURPOSE: Which rows of a Bugs page collapse together, and in what order.
 *
 *          A fingerprint (report_group_id) is per app, so the same Mushi
 *          Mushi check filed in three apps ("Known security hole in next
 *          16.4.2: upgrade to 16.4.5" in glot.it, mushi-mushi and yen-yen)
 *          stayed three rows while the footer said "grouped into 48
 *          fingerprints" (R2 sweep 2026-11-18). A check writes the same
 *          headline for the same finding, so check rows also group by that
 *          headline. Sentry and user titles do not: "An unexpected error
 *          was reported in the app" names many different bugs.
 */

import { reportSourceKind } from '../../lib/reportSourceKind'
import type { ReportRow } from './types'

export interface DisplayRow {
  row: ReportRow
  /** The key the group expands under (URL `expand=`). Set on grouped rows. */
  groupKey?: string
  /** Rows in this group, including the canonical one (>=1). Canonical rows only. */
  variantCount?: number
  /** How many apps the group spans (canonical rows only). */
  appCount?: number
  /** Whether this canonical row's siblings are currently expanded. */
  expanded?: boolean
  /** Set when this row is a sibling rendered under an expanded canonical. */
  isVariantOf?: string
}

/** Short stable hash, so a headline key fits the comma-separated URL param. */
function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** The group a row collapses into, or null for a row that stands alone. */
export function displayGroupKey(row: ReportRow): string | null {
  if (reportSourceKind(row) === 'check') {
    const headline = (row.title ?? row.summary ?? row.description ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    if (headline) return `h${hashText(headline)}`
  }
  return row.report_group_id ?? null
}

/**
 * The display list. Keeps the server's sort: walks the rows in order and
 * emits only the first row of each group, then its siblings when expanded.
 */
export function buildDisplayRows(reports: ReportRow[], groupCollapse: boolean, expandedGroups: ReadonlySet<string>): DisplayRow[] {
  if (!groupCollapse) return reports.map((r) => ({ row: r }))

  const members = new Map<string, ReportRow[]>()
  for (const r of reports) {
    const key = displayGroupKey(r)
    if (!key) continue
    const arr = members.get(key) ?? []
    arr.push(r)
    members.set(key, arr)
  }

  const seen = new Set<string>()
  const out: DisplayRow[] = []
  for (const r of reports) {
    const key = displayGroupKey(r)
    if (!key) {
      out.push({ row: r })
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    const group = members.get(key) ?? [r]
    const expanded = expandedGroups.has(key)
    const appCount = new Set(group.map((m) => m.project_id)).size
    out.push({ row: r, groupKey: key, variantCount: group.length, appCount, expanded })
    if (expanded && group.length > 1) {
      for (const sib of group.slice(1)) out.push({ row: sib, groupKey: key, isVariantOf: key })
    }
  }
  return out
}

/** "+2 similar" chip text and its tooltip for a canonical row. */
export function variantChip(variantCount: number, appCount: number): { label: string; tooltip: string } {
  const more = variantCount - 1
  const reports = `${more} more report${more === 1 ? '' : 's'}`
  return {
    label: `+${more} similar`,
    tooltip: appCount > 1 ? `${reports} of the same bug, across ${appCount} apps` : `${reports} of the same bug`,
  }
}
