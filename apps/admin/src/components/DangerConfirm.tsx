/**
 * FILE: apps/admin/src/components/DangerConfirm.tsx
 * PURPOSE: Type-to-confirm modal for irreversible destructive actions.
 *
 *          Used for project deletion (verified slug must match) and any other
 *          action where ConfirmDialog's single button is too easy to mash by
 *          accident. Pattern matches the GitHub / Vercel / Supabase
 *          danger-zone modals: list what will be lost, require the user to
 *          type the exact resource name, only then enable the red action.
 *
 *          Built on top of `<Modal>` so we inherit focus trap, Esc-to-cancel,
 *          backdrop-click-to-cancel, and dismissible=false during in-flight
 *          deletes (so a user can't accidentally keep clicking Escape mid-API
 *          call and get into a half-deleted state).
 *
 *          Design notes:
 *          - The "type the slug" input is autofocused; the confirm button is
 *            disabled until the value matches `requiredText` exactly.
 *          - `consequences` renders a compact bullet list so users know what
 *            cascades. Concrete numbers ("65 reports", "3 API keys") work
 *            better than vague warnings ("all related data"). For project
 *            delete that's pre-computed on the backend and passed in.
 *          - In-flight: input + button are disabled, button shows a loading
 *            spinner via `loading`. Backdrop click is suppressed so the user
 *            can't escape mid-call.
 */

import { useId, useState } from 'react'
import { Modal } from './Modal'
import { Btn } from './ui'

interface DangerConfirmProps {
  open: boolean
  /** Title shown in the modal header, e.g. "Delete glot.it?" */
  title: string
  /** Short paragraph above the consequences list. */
  body: string
  /** Bulleted list of what will be lost. Empty array hides the section. */
  consequences?: string[]
  /** Exact text the user must type to enable the confirm button. */
  requiredText: string
  /** Help text for the input ("Type the project slug to confirm"). */
  inputLabel: string
  /** Label for the destructive action button. Defaults to "Delete". */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string
  /** True while the API call is in flight; locks UI. */
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function DangerConfirm({
  open,
  title,
  body,
  consequences = [],
  requiredText,
  inputLabel,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: DangerConfirmProps) {
  const [typed, setTyped] = useState('')
  const inputId = useId()
  const matches = typed.trim() === requiredText
  const canConfirm = matches && !loading

  const handleClose = () => {
    if (loading) return
    setTyped('')
    onCancel()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      ariaLabel={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Btn variant="ghost" onClick={handleClose} disabled={loading}>
            {cancelLabel}
          </Btn>
          <Btn
            data-primary
            data-testid="danger-confirm-button"
            variant="danger"
            disabled={!canConfirm}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-2xs text-fg-secondary leading-snug">{body}</p>

        {consequences.length > 0 && (
          <div className="rounded-sm border border-danger/30 bg-danger-muted/10 px-3 py-2 space-y-1">
            <p className="text-3xs font-medium uppercase tracking-wide text-danger">
              This will permanently delete
            </p>
            <ul className="space-y-0.5">
              {consequences.map((line, i) => (
                <li key={i} className="text-2xs text-fg-secondary flex items-start gap-1.5">
                  <span className="text-danger mt-0.5 select-none" aria-hidden>
                    ·
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label htmlFor={inputId} className="block text-2xs font-medium text-fg-muted">
          {inputLabel}
        </label>
        <input
          id={inputId}
          data-testid="danger-confirm-input"
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          disabled={loading}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // The text below the input quotes the required value so
          // pattern-matchers / password managers don't try to autofill.
          placeholder={requiredText}
          className="w-full bg-surface-overlay border border-edge-subtle rounded-sm px-2 py-1.5 text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-danger/40 disabled:opacity-60"
        />
        <p className="text-3xs text-fg-faint leading-snug">
          Type{' '}
          <code className="font-mono text-fg-secondary bg-surface-overlay px-1 py-0.5 rounded-sm">
            {requiredText}
          </code>{' '}
          exactly to enable the {confirmLabel.toLowerCase()} button.
        </p>
      </div>
    </Modal>
  )
}
