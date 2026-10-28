/**
 * FILE: apps/admin/src/components/graph/BugClusterList.tsx
 * PURPOSE: The first answer on Bug clusters: "which bugs share one cause?"
 *          as a list, not a map (console journeys 2026-10-27; report
 *          4659acc8 found the map's groups named by UUID). Each cluster
 *          reads its title, how many reports it holds, its worst severity
 *          and whether a fix is on the way or done, and opens its main
 *          report, where the fix starts. The map stays below.
 *
 * Data: GET /v1/admin/groups (groups with their reports).
 */

import { Link } from 'react-router-dom'
import { Badge, Section } from '../ui'
import { IconNetwork } from '../icons'
import { usePageData } from '../../lib/usePageData'
import { reportGroupLabel, reportGroupSeverity, type ReportGroupLike } from '../../lib/reportGroupDisplay'
import { SEVERITY_TRAFFIC_BADGE } from '../../lib/severityTraffic'
import { pluralize } from '../../lib/format'

interface ClusterGroup extends ReportGroupLike {
  report_count: number
  reports?: Array<{ id: string; summary: string | null; severity: string | null; category?: string | null; status: string }>
}

const FIXED = new Set(['fixed', 'resolved', 'verified'])
const MAX_SHOWN = 8

/** "2 of 5 fixed", "fix on the way", or null when nothing has started. @internal Exported for tests. */
export function clusterFixState(g: Pick<ClusterGroup, 'reports'>): { label: string; tone: 'ok' | 'info' } | null {
  const reports = g.reports ?? []
  const fixed = reports.filter((r) => FIXED.has(r.status)).length
  if (reports.length > 0 && fixed === reports.length) return { label: 'All fixed', tone: 'ok' }
  if (reports.some((r) => r.status === 'fixing')) return { label: 'Fix on the way', tone: 'info' }
  if (fixed > 0) return { label: `${fixed} of ${reports.length} fixed`, tone: 'ok' }
  return null
}

export function BugClusterList() {
  const { data, loading } = usePageData<{ groups: ClusterGroup[] }>('/v1/admin/groups')
  const clusters = (data?.groups ?? []).filter((g) => g.report_count > 1).sort((a, b) => b.report_count - a.report_count)

  return (
    <Section title="Bugs that share a cause" id="graph-clusters" icon={<IconNetwork />}>
      {loading && !data ? (
        <p className="text-xs text-fg-muted">Reading the clusters…</p>
      ) : clusters.length === 0 ? (
        <p className="text-xs text-fg-muted" data-testid="graph-clusters-empty">
          No two bugs share a cause yet. Mushi groups reports with the same root cause as they are diagnosed.
        </p>
      ) : (
        <ul className="divide-y divide-edge-subtle" data-testid="graph-clusters">
          {clusters.slice(0, MAX_SHOWN).map((g) => {
            const severity = reportGroupSeverity(g)
            const state = clusterFixState(g)
            const main = g.canonical_report_id ?? g.reports?.[0]?.id ?? null
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`graph-cluster-${g.id}`}>
                <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-fg-secondary">
                  {g.report_count} {pluralize(g.report_count, 'report')}
                </span>
                <span className="min-w-0 flex-1 basis-48 wrap-break-word text-xs font-medium text-fg">{reportGroupLabel(g)}</span>
                {severity && <Badge className={SEVERITY_TRAFFIC_BADGE[severity] ?? SEVERITY_TRAFFIC_BADGE.low}>{severity}</Badge>}
                {state && <Badge tone={state.tone}>{state.label}</Badge>}
                {main && (
                  <Link to={`/reports/${main}`} className="shrink-0 text-2xs font-medium text-brand hover:underline">
                    Open main report →
                  </Link>
                )}
              </li>
            )
          })}
          {clusters.length > MAX_SHOWN && (
            <li className="py-2 text-2xs text-fg-muted">
              {clusters.length - MAX_SHOWN} more on the Backend tab, with merge.
            </li>
          )}
        </ul>
      )}
    </Section>
  )
}
