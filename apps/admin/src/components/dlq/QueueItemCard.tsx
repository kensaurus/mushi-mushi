/**
 * FILE: apps/admin/src/components/dlq/QueueItemCard.tsx
 * PURPOSE: Single queue item row — stage badge, attempts, last error,
 *          report link, and a per-item retry button.
 */

import { Link } from 'react-router-dom'
import { Card, Badge, Btn, RelativeTime } from '../ui'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../../lib/tokens'
import type { QueueItem } from './types'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'

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
            <SignalChip tone="neutral" className="font-mono">
              {item.attempts}/{item.max_attempts} attempts
            </SignalChip>
            {waitingChip && (
              <span title={`This job has been ${item.status === 'running' ? 'running' : 'queued'} for ${waitingChip}`}>
                <SignalChip tone="warn" className="font-mono">
                  Waiting {waitingChip}
                </SignalChip>
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
            <ContainedBlock tone="warn" className="mt-1.5">
              <pre className="max-h-16 overflow-auto text-2xs text-danger font-mono whitespace-pre-wrap">
                {item.last_error}
              </pre>
            </ContainedBlock>
          )}
          <InlineProof className="mt-1">
            Created <RelativeTime value={item.created_at} />
            {item.completed_at && (
              <>
                {' '}· last attempt <RelativeTime value={item.completed_at} />
              </>
            )}
          </InlineProof>
        </div>
        <Btn
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          loading={retrying}
          className="ml-3 flex-shrink-0"
        >
          Retry
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
