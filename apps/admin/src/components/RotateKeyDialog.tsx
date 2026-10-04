/**
 * FILE: apps/admin/src/components/RotateKeyDialog.tsx
 * PURPOSE: Confirm, then rotate exactly one project API key. Lists the key
 *          that will be revoked and warns that live apps using it stop
 *          reporting (QA bug 31). Used by the SDK install key panel and the
 *          project-created success panel.
 */
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { rotateKeyConfirmCopy, rotateProjectKey, type RotatableKey, type RotatedKey } from '../lib/projectKeys'

export function RotateKeyDialog({
  projectId,
  apiKey,
  onRotated,
  onError,
  onCancel,
}: {
  projectId: string
  apiKey: RotatableKey
  onRotated: (rotated: RotatedKey) => void
  onError: (message: string) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const copy = rotateKeyConfirmCopy(apiKey)

  async function confirm() {
    setBusy(true)
    const res = await rotateProjectKey(projectId, apiKey.id)
    setBusy(false)
    if (res.ok) onRotated(res.data)
    else onError(res.message)
  }

  return (
    <ConfirmDialog
      title={copy.title}
      body={copy.body}
      details={
        <ul className="list-disc space-y-0.5 pl-4 font-mono" data-testid="rotate-key-details">
          {copy.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      }
      confirmLabel="Rotate this key"
      tone="danger"
      loading={busy}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  )
}
