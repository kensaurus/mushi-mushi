/**
 * FILE: apps/admin/src/components/reports/DismissReportDialog.tsx
 * PURPOSE: Confirm before the /reports row "Dismiss" closes a report. The ×
 *          sits next to "Copy link" and "Open in new tab", and dismissing
 *          tells the reporter their report was closed, a message that cannot
 *          be taken back (2026-10-04 console audit, group B #18).
 */

import { useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { CloseReasonSelect } from './CloseReasonSelect'

interface Props {
  report: { id: string }
  onClose: () => void
  /** Called after the server accepted the dismiss, to reload the list. */
  onDismissed: () => void
}

export function DismissReportDialog({ report, onClose, onDismissed }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')

  const dismiss = async () => {
    setBusy(true)
    const res = await apiFetch(`/v1/admin/reports/${report.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed', ...(reason ? { closed_reason: reason } : {}) }),
    })
    setBusy(false)
    onClose()
    if (res.ok) {
      toast.success('Report dismissed', 'To undo it, open the report and change its status.')
      onDismissed()
    } else {
      toast.error('Could not dismiss the report', 'Nothing was changed. Try again in a moment.')
    }
  }

  return (
    <ConfirmDialog
      title="Dismiss this report?"
      body="The reporter gets the message below, and it cannot be taken back."
      confirmLabel="Dismiss"
      tone="danger"
      loading={busy}
      onCancel={() => {
        if (!busy) onClose()
      }}
      onConfirm={dismiss}
    >
      <CloseReasonSelect value={reason} onChange={setReason} />
    </ConfirmDialog>
  )
}
