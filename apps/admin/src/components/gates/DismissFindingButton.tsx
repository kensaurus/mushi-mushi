/**
 * FILE: apps/admin/src/components/gates/DismissFindingButton.tsx
 * PURPOSE: Dismiss one gate finding with a required reason
 *          (POST /v1/admin/projects/:pid/gate-findings/:id/dismiss). The
 *          server sets the finding's allowlisted flag and reason, so every
 *          open-finding list and count stops showing it, and audits the
 *          dismissal. A themed prompt asks for the reason (3 to 300
 *          characters); nothing is sent without one.
 *
 *          A dismissal covers this finding only: if the next run of the
 *          check finds the same thing, it is listed again.
 *
 *          Viewers are read-only on the server, so they get no button.
 */

import { useState } from 'react'
import { PromptDialog } from '../ConfirmDialog'
import { Btn } from '../ui'
import { apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeApiError } from '../../lib/humanizeApiError'
import { useActiveOrgRole } from '../../lib/useActiveOrgRole'

interface Props {
  projectId: string
  findingId: string
  /** Called after the server dismissed it, e.g. to reload the list. */
  onDismissed?: () => void
}

function validateDismissReason(reason: string): string | null {
  const n = reason.trim().length
  if (n < 3) return 'Say why this finding is not a problem (at least 3 characters).'
  if (n > 300) return `Keep the reason to 300 characters or fewer (${n} now).`
  return null
}

export function DismissFindingButton({ projectId, findingId, onDismissed }: Props) {
  const toast = useToast()
  const { role } = useActiveOrgRole()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  if (role === 'viewer') return null

  const dismiss = async (reason: string) => {
    setSaving(true)
    const res = await apiFetchMutate<{ id: string; alreadyDismissed: boolean }>(
      `/v1/admin/projects/${encodeURIComponent(projectId)}/gate-findings/${encodeURIComponent(findingId)}/dismiss`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    )
    setSaving(false)
    if (!res.ok) {
      const e = describeApiError(res.error, 'Could not dismiss the finding')
      toast.error(e.title, e.hint)
      return
    }
    setOpen(false)
    toast.success('Finding dismissed', 'It comes back only if a later run of this check finds it again.')
    onDismissed?.()
  }

  return (
    <>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(true)} title="Dismiss this finding with a reason">
        Dismiss
      </Btn>
      {open && (
        <PromptDialog
          title="Dismiss this finding?"
          body="It stops counting as open. The reason is saved in the audit log. If a later run of this check finds the same thing, it is listed again."
          label="Why is this not a problem?"
          placeholder="For example: a false positive; the crawler fetched localhost"
          confirmLabel="Dismiss finding"
          loading={saving}
          validate={validateDismissReason}
          onConfirm={dismiss}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  )
}
