/**
 * FILE: apps/admin/src/components/pipeline/PipelineActionDialog.tsx
 * PURPOSE: The confirm step of a pipeline action: what it changes, on how
 *          many PRs, and (for Close and Remove) the reason, which is kept as
 *          a team note on each report. "Not a code bug" closes the reports
 *          with a close reason the reporter is told.
 */

import { useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { Textarea } from '../ui'
import { CloseReasonSelect } from '../reports/CloseReasonSelect'
import { ACTION_META, type PipelineAction } from '../../lib/pipeline'

export interface PendingAction {
  action: PipelineAction
  fixIds: string[]
  /** Lined up with fixIds: the report each item belongs to ("Not a code bug" closes it). */
  reportIds?: Array<string | null>
  /** "12 PRs: their own CI is red", or the one PR's title. */
  target: string
}

interface Props {
  pending: PendingAction
  busy: boolean
  onConfirm: (reason: string | undefined) => void
  onCancel: () => void
}

export function PipelineActionDialog({ pending, busy, onConfirm, onCancel }: Props) {
  const meta = ACTION_META[pending.action]
  const isDismiss = pending.action === 'dismiss'
  const [reason, setReason] = useState(isDismiss ? 'wont_fix' : '')
  const n = pending.fixIds.length
  const tooShort = meta.needsReason && reason.trim().length < 3
  return (
    <ConfirmDialog
      title={`${meta.label}${n > 1 ? ` · ${n} ${isDismiss || pending.action === 'requeue' ? 'reports' : 'PRs'}` : ''}`}
      body={meta.confirm}
      details={<span className="font-medium text-fg">{pending.target}</span>}
      confirmLabel={meta.label}
      tone={meta.variant === 'danger' ? 'danger' : 'default'}
      loading={busy}
      confirmDisabled={tooShort}
      onConfirm={() => onConfirm(meta.needsReason || isDismiss ? reason.trim() || undefined : undefined)}
      onCancel={onCancel}
    >
      {isDismiss && <CloseReasonSelect value={reason} onChange={setReason} count={n} />}
      {meta.needsReason && (
        <Textarea
          label="Why? Kept as a team note on each report."
          id="pipeline-action-reason"
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="For example: fixed by hand in #44"
          data-testid="pipeline-action-reason"
        />
      )}
    </ConfirmDialog>
  )
}
