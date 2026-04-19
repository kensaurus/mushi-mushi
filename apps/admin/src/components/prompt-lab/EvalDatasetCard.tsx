import { Link } from 'react-router-dom'
import { Card, EmptyState, RelativeTime } from '../ui'
import type { DatasetSample } from './types'

interface EvalDatasetCardProps {
  total: number
  labelled: number
  recentSamples: DatasetSample[]
}

export function EvalDatasetCard({ labelled, recentSamples }: EvalDatasetCardProps) {
  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-fg-secondary">
          Eval dataset · recent classified reports
        </h3>
        <span className="text-2xs text-fg-faint font-mono">
          {labelled.toLocaleString()} labelled
        </span>
      </div>
      {recentSamples.length === 0 ? (
        <EmptyState
          title="No labelled reports yet"
          description="Once Stage 2 classifies reports, they appear here as the eval dataset for your next prompt experiment."
        />
      ) : (
        <ul className="space-y-1.5 text-xs">
          {recentSamples.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-2 border-t border-edge-subtle pt-1.5 first:border-0 first:pt-0"
            >
              <div className="flex-1 min-w-0">
                <Link
                  to={`/reports/${s.id}`}
                  className="text-fg-secondary hover:text-fg underline-offset-2 hover:underline"
                >
                  {s.description?.slice(0, 140) ?? '(no description)'}
                </Link>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-2xs font-mono text-fg-muted">
                  {s.category && <span>cat: {s.category}</span>}
                  {s.severity && <span>sev: {s.severity}</span>}
                  {s.component && <span>cmp: {s.component}</span>}
                </div>
              </div>
              <RelativeTime value={s.created_at} className="text-2xs text-fg-faint shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
