/**
 * FILE: apps/admin/src/components/settings/StoredSecretStatus.tsx
 * PURPOSE: Status line under a secret field in General settings. The server
 *          never returns stored secrets, and an empty field means "keep the
 *          saved one", so removing a secret is an explicit action: Remove →
 *          confirm → PATCH that one column to null.
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { ConfirmDialog } from '../ConfirmDialog'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

interface StoredSecretStatusProps {
  /** project_settings column, e.g. `sentry_webhook_secret`. */
  column: string
  /** Lower-case noun for the copy, e.g. "Sentry webhook secret". */
  label: string
  /** The `<column>_set` flag from GET /v1/admin/settings. */
  isSet: boolean
  /** What stops working once it is gone, shown in the confirm step. */
  consequence: string
  onRemoved: () => void
}

export function StoredSecretStatus({ column, label, isSet, consequence, onRemoved }: StoredSecretStatusProps) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function remove() {
    setRemoving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ [column]: null }),
    })
    setRemoving(false)
    if (res.ok) {
      setConfirming(false)
      toast.success(`${label} removed`)
      onRemoved()
    } else {
      toast.error(`Could not remove the ${label.toLowerCase()}`, res.error?.message)
    }
  }

  if (!isSet) {
    return <p className="mt-1 text-xs text-fg-muted">Not saved yet</p>
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="text-xs text-ok">Saved</span>
      <Btn variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Remove ${label.toLowerCase()}`}>
        Remove
      </Btn>
      {confirming && (
        <ConfirmDialog
          title={`Remove the ${label.toLowerCase()}?`}
          body={consequence}
          confirmLabel="Remove"
          tone="danger"
          loading={removing}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
