/**
 * FILE: apps/admin/src/components/dashboard/QaCoverageTile.tsx
 * PURPOSE: Dashboard tile summarising the QA Coverage suite — total stories,
 *          pass rate, top failing story, and a link to /qa-coverage.
 *
 * OVERVIEW:
 * - Reads from the `qa_story_coverage_24h` materialized view via the
 *   `/v1/admin/projects/:id/qa-coverage-summary` endpoint.
 * - Shows: total stories, % green (passing), failing story names (up to 3).
 * - Mirrors the density of `SdkHealthSummary` so it slots into the dashboard
 *   grid without disrupting the visual rhythm.
 *
 * USAGE:
 *   <QaCoverageTile projectId={projectId} />
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { Card } from '../ui'
import { ActionPill, ContainedBlock, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

interface CoverageSummary {
  total: number
  passing: number
  failing: number
  error: number
  top_failing: Array<{ story_id: string; name: string; pass_rate_pct: number | null }>
}

function PassRateBar({ pct }: { pct: number }) {
  const tone = pct >= 80 ? 'bg-ok' : pct >= 50 ? 'bg-warn' : 'bg-danger'
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-overlay overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function QaCoverageTile({ projectId }: { projectId: string }) {
  const { data, loading, error } = usePageData<CoverageSummary>(
    `/v1/admin/projects/${projectId}/qa-coverage-summary`,
    { deps: [projectId] },
  )

  const passRate = data && data.total > 0
    ? Math.round((data.passing / data.total) * 100)
    : null

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Link
          to="/qa-coverage"
          className="text-2xs font-semibold text-fg-secondary uppercase tracking-wider hover:text-fg transition-colors"
        >
          QA Coverage
        </Link>
        <Link to="/qa-coverage" className="text-2xs text-brand hover:underline">
          View all →
        </Link>
      </div>

      {loading && (
        <div className="space-y-1">
          <div className="h-4 w-full rounded-sm bg-surface-raised animate-pulse" />
          <div className="h-4 w-3/4 rounded-sm bg-surface-raised animate-pulse" />
        </div>
      )}

      {error && (
        <EmptySectionMessage text="QA Coverage not available." />
      )}

      {!loading && !error && !data?.total && (
        <ContainedBlock tone="muted" className="space-y-2">
          <p className="text-2xs text-fg-muted">No QA stories yet.</p>
          <ActionPill to="/qa-coverage" tone="brand">
            Create your first user story test →
          </ActionPill>
        </ContainedBlock>
      )}

      {!loading && !error && data && data.total > 0 && (
        <div className="space-y-2">
          {/* Summary row */}
          <div className="flex items-center gap-3 text-2xs">
            <span className="text-fg font-mono font-semibold">{data.total}</span>
            <span className="text-fg-muted">stories</span>
            {passRate !== null && (
              <>
                <span
                  className={`ml-auto font-semibold ${passRate >= 80 ? 'text-ok' : passRate >= 50 ? 'text-warn' : 'text-danger'}`}
                >
                  {passRate}% passing
                </span>
              </>
            )}
          </div>

          {/* Pass rate bar */}
          {passRate !== null && <PassRateBar pct={passRate} />}

          {/* Top failing */}
          {data.top_failing.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-edge-subtle/60">
              <SignalChip tone="danger" className="uppercase tracking-wider text-3xs">Failing</SignalChip>
              {data.top_failing.slice(0, 3).map((f) => (
                <Link
                  key={f.story_id}
                  to={`/qa-coverage?highlight=${f.story_id}`}
                  className="flex items-center gap-2 hover:bg-surface-overlay rounded-sm px-1 py-0.5 -mx-1 transition-colors group"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-danger shrink-0" />
                  <span className="text-2xs text-fg-secondary truncate flex-1 group-hover:text-fg">
                    {f.name}
                  </span>
                  {f.pass_rate_pct !== null && (
                    <span className="text-3xs font-mono text-danger shrink-0">
                      {f.pass_rate_pct}%
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
