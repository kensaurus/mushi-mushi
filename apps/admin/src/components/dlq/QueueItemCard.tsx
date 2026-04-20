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

const WAITING_STATUSES = new Set(['pending', 'running'])

export function QueueItemCard({ item, retrying, onRetry }: Props) {
  const waitingMs =
    WAITING_STATUSES.has(item.status) && item.created_at
      ? Date.now() - new Date(item.created_at).getTime()
      : null
  const waitingChip = waitingMs !== null && waitingMs > 0 ? formatWaiting(waitingMs) : null
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge
              className={PIPELINE_STATUS[item.status] ?? 'bg-surface-overlay text-fg-muted'}
            >
              {item.stage} · {pipelineStatusLabel(item.status)}
            </Badge>
            <span className="text-2xs text-fg-muted font-mono">
              {item.attempts}/{item.max_attempts} attempts
            </span>
            {waitingChip && (
              <span
                className="text-2xs text-warn font-mono px-1.5 py-0.5 rounded-sm bg-warn/10 border border-warn/20"
                title={`This job has been ${item.status === 'running' ? 'running' : 'queued'} for ${waitingChip}`}
              >
                Waiting {waitingChip}
              </span>
            )}
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

function formatWaiting(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 1) return '<1m'
  if (totalMin < 60) return `${totalMin}m`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}
