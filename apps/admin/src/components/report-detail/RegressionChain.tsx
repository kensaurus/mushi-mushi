import { Link } from 'react-router-dom'
import { Card } from '../../components/ui'
import { IconLink } from '../icons'
import type { ReportDetail } from './types'

interface RegressionChainProps {
  report: ReportDetail
  className?: string
}

/**
 * Surfaces parent/child regression links when a report was reopened or
 * spawned from a prior fix verification.
 */
export function RegressionChain({ report, className = '' }: RegressionChainProps) {
  const parentId = report.parent_report_id
  const childIds = report.child_report_ids ?? []
  const regressionCount = report.regression_count ?? 0

  if (!parentId && childIds.length === 0 && regressionCount === 0) return null

  return (
    <Card className={`p-3 ${className}`}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-secondary mb-2">
        <IconLink /> Regression chain
      </h3>
      <ul className="space-y-1.5 text-xs text-fg-secondary">
        {parentId && (
          <li>
            Reopened from{' '}
            <Link to={`/reports/${parentId}`} className="text-accent hover:text-accent-hover font-medium">
              parent report
            </Link>
            {report.reopened_at && (
              <span className="text-fg-muted"> · {new Date(report.reopened_at).toLocaleString()}</span>
            )}
          </li>
        )}
        {regressionCount > 0 && (
          <li className="text-fg-muted">
            Regression count: <span className="text-fg-secondary font-medium">{regressionCount}</span>
          </li>
        )}
        {report.verified_at && (
          <li className="text-fg-muted">
            Reporter verified: <span className="text-fg-secondary">{new Date(report.verified_at).toLocaleString()}</span>
          </li>
        )}
        {childIds.length > 0 && (
          <li>
            Child regressions:{' '}
            {childIds.map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                <Link to={`/reports/${id}`} className="text-accent hover:text-accent-hover font-medium">
                  {id.slice(0, 8)}…
                </Link>
              </span>
            ))}
          </li>
        )}
      </ul>
    </Card>
  )
}
