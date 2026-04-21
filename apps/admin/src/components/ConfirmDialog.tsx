/**
 * FILE: apps/admin/src/components/ConfirmDialog.tsx
 * PURPOSE: Themed replacement for window.confirm + window.prompt
 *
 *          The browser-native dialogs are jarring on a dark themed app,
 *          can't carry destructive-action affordances, and break Playwright
 *          smoke tests. This file ships two declarative components that
 *          drop into the same shell other modals on the app use
 *          (PromptEditorModal, FirstRunTour) so they're visually
 *          consistent and keyboard-accessible.
 *
 *          Both render to a fixed overlay, focus the primary input/button
 *          on mount, close on Escape, and forward Enter to the primary
 *          action. They are uncontrolled — keep state in the parent.
 */

import { useEffect, useRef, useState } from 'react'
import { Btn, Card } from './ui'

type ConfirmTone = 'default' | 'danger'

interface ConfirmDialogProps {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Btn doesn't forwardRef yet, so we focus the primary action via a
  // wrapper span query after mount. Same accessibility outcome.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    wrapperRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, onCancel])

  return (
    <DialogShell title={title} onCancel={loading ? () => {} : onCancel}>
      {body && <p className="text-2xs text-fg-secondary leading-snug">{body}</p>}
      <div ref={wrapperRef} className="flex justify-end gap-1.5 pt-1">
        <Btn variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Btn>
        <Btn
          data-primary
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={() => void onConfirm()}
          loading={loading}
        >
          {confirmLabel}
        </Btn>
      </div>
    </DialogShell>
  )
}

interface PromptDialogProps {
  title: string
  body?: string
  label: string
  /** Initial value pre-filled in the input. */
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Optional input type — defaults to 'text'. Pass 'number' for counts. */
  inputType?: 'text' | 'number'
  /** Validate before submit. Return null when valid, or an error to show. */
  validate?: (value: string) => string | null
  loading?: boolean
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

export function PromptDialog({
  title,
  body,
  label,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  inputType = 'text',
  validate,
  loading = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const [validationError, setValidationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, onCancel])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    const trimmed = value.trim()
    const error = validate ? validate(trimmed) : null
    if (error) {
      setValidationError(error)
      return
    }
    setValidationError(null)
    void onConfirm(trimmed)
  }

  return (
    <DialogShell title={title} onCancel={loading ? () => {} : onCancel}>
      <form onSubmit={handleSubmit} className="space-y-2">
        {body && <p className="text-2xs text-fg-secondary leading-snug">{body}</p>}
        <label className="block text-2xs font-medium text-fg-muted">
          {label}
          <input
            ref={inputRef}
            type={inputType}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.currentTarget.value)
              if (validationError) setValidationError(null)
            }}
            disabled={loading}
            className="mt-1 w-full bg-surface-overlay border border-edge-subtle rounded-sm px-2 py-1.5 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-60"
          />
        </label>
        {validationError && (
          <p role="alert" className="text-2xs text-danger leading-snug">
            {validationError}
          </p>
        )}
        <div className="flex justify-end gap-1.5 pt-1">
          <Btn type="button" variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Btn>
          <Btn type="submit" loading={loading}>
            {confirmLabel}
          </Btn>
        </div>
      </form>
    </DialogShell>
  )
}

interface DialogShellProps {
  title: string
  children: React.ReactNode
  onCancel: () => void
}

function DialogShell({ title, children, onCancel }: DialogShellProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 motion-safe:animate-mushi-fade-in"
      onClick={onCancel}
    >
      <Card
        elevated
        className="w-full max-w-md p-4 space-y-2 motion-safe:animate-mushi-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <button
            type="button"
            className="text-fg-muted hover:text-fg text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm w-6 h-6 flex items-center justify-center"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </Card>
    </div>
  )
}
