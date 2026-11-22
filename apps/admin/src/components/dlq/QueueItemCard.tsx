/**
 * FILE: apps/admin/src/components/dlq/QueueItemCard.tsx
 * PURPOSE: Single queue item row — stage badge, attempts, last error,
 *          report link, and a per-item retry button.
 */

import { Link } from 'react-router-dom'
import { Card, Badge, Btn, RelativeTime } from '../ui'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../../lib/tokens'
import { queueStageLabel, readableQueueError, waitedLabel, type QueueItem } from './types'
import { ContainedBlock, InlineProof, SignalChip } from '../report-detail/ReportSurface'

interface Props {
  item: QueueItem
  retrying: boolean
  /** False hides Retry: completed and still-active jobs are not retried. */
  canRetry: boolean
  onRetry: () => void
}

const WAITING_STATUSES = new Set(['pending', 'running'])

export function QueueItemCard({ item, retrying, canRetry, onRetry }: Props) {
  const waitingMs =
    WAITING_STATUSES.has(item.status) && item.created_at
      ? Date.now() - new Date(item.created_at).getTime()
      : null
  // "Waiting 579h 57m" read as a clock, not an age (console audit 2026-11-21).
  const waitingChip = waitingMs !== null && waitingMs > 0 ? waitedLabel(waitingMs / 60_000) : null
  const error = item.last_error ? readableQueueError(item.last_error) : null
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge
              className={PIPELINE_STATUS[item.status] ?? 'bg-surface-overlay text-fg-muted'}
            >
              {queueStageLabel(item.stage)} · {pipelineStatusLabel(item.status)}
            </Badge>
            <SignalChip tone="neutral" className="font-mono">
              {item.attempts}/{item.max_attempts} attempts
            </SignalChip>
            {waitingChip && (
              <span title={`This job has been ${item.status === 'running' ? 'running' : 'queued'} for ${waitingChip}`}>
                <SignalChip tone="warn">
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
          {error && (
            <ContainedBlock tone="warn" className="mt-1.5">
              <p className="text-2xs text-danger" data-testid="queue-item-error">
                {error.text}
              </p>
              {error.detail && (
                <details className="mt-1 text-2xs text-fg-muted">
                  <summary className="cursor-pointer">Raw error</summary>
                  <pre className="mt-1 max-h-16 overflow-auto font-mono whitespace-pre-wrap">{error.detail}</pre>
                </details>
              )}
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
        {canRetry && (
          <Btn
            variant="ghost"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            loading={retrying}
            className="ml-3 flex-shrink-0"
            title="Run this job again from the start. Mushi Mushi diagnoses the report again."
          >
            Retry
          </Btn>
        )}
      </div>
    </Card>
  )
}
