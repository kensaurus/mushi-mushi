/**
 * FILE: apps/admin/src/components/design/TokenEditor.tsx
 * PURPOSE: The per-token Edit affordance. Shows an inline form for editable
 *          tokens (colour, dimension, duration, number, font family) and the
 *          reason a token is read-only otherwise. Submitting only QUEUES the
 *          edit; nothing is sent until the queue is previewed and confirmed.
 */

import { useState } from 'react'
import { Btn, Input } from '../ui'
import type { DesignEditability, DesignToken, TokenEdit } from '../../lib/recipeTypes'
import { initialEditText, parseEditValue, tokenEditBlocker } from './designTokens'

interface TokenEditorProps {
  token: DesignToken
  editable: DesignEditability
  set: string | null
  queued: TokenEdit | undefined
  onQueue: (edit: TokenEdit) => void
  /** True while a preview/PR request is in flight or its result is on screen. */
  locked: boolean
}

export function TokenEditor({ token, editable, set, queued, onQueue, locked }: TokenEditorProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Page-level reason covers the whole page when editing is off; stay quiet here.
  if (!editable.enabled) return null
  const blocker = tokenEditBlocker(token, editable)
  if (blocker) {
    return <p className="text-2xs text-fg-faint">Read-only: {blocker}</p>
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          size="sm"
          variant="ghost"
          disabled={locked}
          title={locked ? 'Finish or discard the current change first' : `Edit ${token.path}`}
          onClick={() => {
            setText(queued ? (Array.isArray(queued.value) ? queued.value.join(', ') : String(queued.value)) : initialEditText(token))
            setError(null)
            setOpen(true)
          }}
          aria-label={`Edit ${token.path}`}
        >
          Edit
        </Btn>
        {queued && <span className="text-2xs text-fg-muted">Queued</span>}
      </div>
    )
  }

  const isColor = token.type === 'color'
  const pickerValue = isColor && /^#[0-9a-f]{6}$/i.test(text.trim()) ? text.trim() : null

  const submit = () => {
    if (locked) return
    const parsed = parseEditValue(token.type, text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    onQueue({ path: token.path, value: parsed.value, ...(set ? { set } : {}) })
    setOpen(false)
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            label={`New value for ${token.path}`}
            id={`token-edit-${token.path}`}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            error={error ?? undefined}
            autoFocus
          />
        </div>
        {pickerValue && (
          <label className="flex flex-col gap-1 text-2xs text-fg-muted">
            Picker
            <input
              type="color"
              value={pickerValue}
              onChange={(e) => setText(e.target.value.toUpperCase())}
              className="h-8 w-10 cursor-pointer rounded-sm border border-edge-subtle"
              aria-label={`Pick a colour for ${token.path}`}
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn
          size="sm"
          variant="primary"
          type="submit"
          disabled={locked}
          title={locked ? 'Finish or discard the current change first' : 'Add this edit to the queue'}
        >
          {queued ? 'Update queued edit' : 'Add to queue'}
        </Btn>
        <Btn size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Btn>
      </div>
    </form>
  )
}
