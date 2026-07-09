/**
 * FILE: apps/admin/src/components/dashboard/QaCoverageTile.tsx
 * PURPOSE: Dashboard tile summarising the QA Coverage suite — total stories,
 *          pass rate, top failing story, and a link to /qa-coverage.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { CardPanel, PanelSubheader } from '../ui'

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
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay">
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
    <CardPanel
      title={
        <Link
          to="/qa-coverage"
          className="motion-safe:transition-colors hover:text-fg"
        >
          QA Coverage
        </Link>
      }
      action={
        <Link to="/qa-coverage" className="text-2xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
          View all →
        </Link>
      }
    >
      {loading && (
        <div className="space-y-1">
          <div className="h-4 w-full animate-pulse rounded-sm bg-surface-raised" />
          <div className="h-4 w-3/4 animate-pulse rounded-sm bg-surface-raised" />
        </div>
      )}

      {error && (
        <p className="text-2xs italic text-fg-faint">QA Coverage not available.</p>
      )}

      {!loading && !error && !data?.total && (
        <div className="space-y-1 text-2xs text-fg-faint">
          <p>No QA stories yet.</p>
          <Link to="/qa-coverage" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
            Create your first user story test →
          </Link>
        </div>
      )}

      {!loading && !error && data && data.total > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-2xs">
            <span className="font-mono font-semibold text-fg">{data.total}</span>
            <span className="text-fg-muted">stories</span>
            {passRate !== null && (
              <span
                className={`ml-auto font-semibold ${passRate >= 80 ? 'text-ok' : passRate >= 50 ? 'text-warn' : 'text-danger'}`}
              >
                {passRate}% passing
              </span>
            )}
          </div>

          {passRate !== null && <PassRateBar pct={passRate} />}

          {data.top_failing.length > 0 && (
            <div className="min-w-0 space-y-1 pt-2">
              <PanelSubheader title="Failing" />
              {data.top_failing.slice(0, 3).map((f) => (
                <Link
                  key={f.story_id}
                  to={`/qa-coverage?highlight=${f.story_id}`}
                  className="group -mx-1 flex items-center gap-2 rounded-sm px-1 py-0.5 motion-safe:transition-colors hover:bg-surface-overlay"
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-2xs text-fg-secondary group-hover:text-fg">
                    {f.name}
                  </span>
                  {f.pass_rate_pct !== null && (
                    <span className="shrink-0 font-mono text-3xs text-danger">
                      {f.pass_rate_pct}%
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </CardPanel>
  )
}
