/**
 * FILE: apps/admin/src/components/dlq/QueueItemCard.tsx
 * PURPOSE: Single queue item row — stage badge, attempts, last error,
 *          report link, and a per-item retry button.
 */

import { Link } from 'react-router-dom'
import { Card, Badge, Btn, RelativeTime } from '../ui'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../../lib/tokens'
import type { QueueItem } from './types'

interface Props {
  item: QueueItem
  retrying: boolean
  onRetry: () => void
}

export function QueueItemCard({ item, retrying, onRetry }: Props) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge
              className={PIPELINE_STATUS[item.status] ?? 'bg-surface-overlay text-fg-muted'}
            >
              {item.stage} · {pipelineStatusLabel(item.status)}
            </Badge>
            <span className="text-2xs text-fg-muted font-mono">
              {item.attempts}/{item.max_attempts} attempts
            </span>
          </div>
          <Link
            to={`/reports/${item.report_id}`}
            className="text-xs text-fg-secondary hover:text-fg truncate block"
          >
            {item.reports?.description?.slice(0, 150) ?? item.report_id}
          </Link>
          {item.last_error && (
            <pre className="mt-1.5 max-h-16 overflow-auto rounded-sm bg-danger-muted/30 p-1.5 text-2xs text-danger font-mono">
              {item.last_error}
            </pre>
          )}
          <p className="mt-1 text-2xs text-fg-muted">
            Created <RelativeTime value={item.created_at} />
            {item.completed_at && (
              <>
                {' '}· last attempt <RelativeTime value={item.completed_at} />
              </>
            )}
          </p>
        </div>
        <Btn
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="ml-3 flex-shrink-0"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Btn>
      </div>
    </Card>
  )
}
