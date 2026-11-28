/**
 * FILE: apps/admin/src/components/settings/CursorModelPicker.tsx
 * PURPOSE: Cursor model picker (review follow-ups ADR 0032, spend-down and
 *          the Cursor card on Integrations, BL-090). Loads
 *          GET /v1/admin/byok/cursor/models and writes a spec string
 *          (`id` or `id?param=value&…`). keyId asks for that Cursor account;
 *          omit it to use the key the app would use. A failed or empty list
 *          falls back to the text field. "Other" keeps a typed spec for an
 *          id the list does not have.
 */

import { useState } from 'react'
import { Input, SelectField } from '../ui'
import { usePageData } from '../../lib/usePageData'
import {
  CURSOR_MODEL_OTHER,
  cursorModelSelection,
  cursorModelSpec,
  type CursorModelOption,
  type CursorModelParam,
} from './cursorModelSpec'

interface Props {
  value: string
  onChange: (spec: string) => void
  /** byok_keys id. Omit to use the key the app would use. */
  keyId?: string
  label?: string
  /** When false, the parent already shows the label. The control keeps aria-label. */
  labelled?: boolean
  tooltip?: string
  helpId?: string
  emptyLabel: string
}

function paramValues(param: CursorModelParam, current: string) {
  if (current && !param.values.some((v) => v.value === current)) {
    return [{ value: current, displayName: current }, ...param.values]
  }
  return param.values
}

export function CursorModelPicker({
  value,
  onChange,
  keyId,
  label = 'Model (optional)',
  labelled = true,
  tooltip,
  helpId,
  emptyLabel,
}: Props) {
  const path = keyId
    ? `/v1/admin/byok/cursor/models?keyId=${encodeURIComponent(keyId)}`
    : '/v1/admin/byok/cursor/models'
  const models = usePageData<{ models: CursorModelOption[] }>(path, { deps: [keyId ?? ''] })
  const list = models.data?.models ?? []
  const listReady = !models.loading && !models.error && models.data != null
  const selection = cursorModelSelection(value, list, listReady)
  // Empty means the account default, so "Other" is local until an id is typed.
  // A new key starts over: an id the previous account lacked may be in this list.
  const [trackedKey, setTrackedKey] = useState(keyId)
  const [otherOpen, setOtherOpen] = useState(false)
  if (trackedKey !== keyId) {
    setTrackedKey(keyId)
    setOtherOpen(false)
  }
  const inOther = otherOpen || selection.modelId === CURSOR_MODEL_OTHER
  const chosen = inOther ? undefined : list.find((m) => m.id === selection.modelId)
  const visibleLabel = labelled ? label : undefined
  const customText = selection.modelId === CURSOR_MODEL_OTHER ? selection.custom : value

  if (models.error || (listReady && list.length === 0)) {
    return (
      <div>
        <Input
          label={visibleLabel}
          aria-label={label}
          tooltip={tooltip}
          helpId={helpId}
          value={value}
          placeholder="e.g. grok-4.7?reasoning_effort=xhigh"
          onChange={(e) => onChange(e.target.value)}
        />
        {models.error && (
          <p className="mt-1 text-2xs text-fg-muted">
            Cursor&apos;s model list did not load. Type a model id, and add settings after a ?.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label={visibleLabel}
        aria-label={label}
        tooltip={tooltip}
        helpId={helpId}
        value={inOther ? CURSOR_MODEL_OTHER : selection.modelId}
        onChange={(e) => {
          const id = e.target.value
          if (id === CURSOR_MODEL_OTHER) {
            setOtherOpen(true)
            return
          }
          setOtherOpen(false)
          // Leaving Other for the model the spec already names keeps its settings.
          if (id !== '' && id === selection.modelId) return
          onChange(id)
        }}
      >
        <option value="">{emptyLabel}</option>
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName && m.displayName !== m.id ? `${m.displayName} — ${m.id}` : m.id}
          </option>
        ))}
        {selection.modelId &&
          selection.modelId !== CURSOR_MODEL_OTHER &&
          !list.some((m) => m.id === selection.modelId) && (
            <option value={selection.modelId}>{selection.modelId}</option>
          )}
        <option value={CURSOR_MODEL_OTHER}>Other model id…</option>
      </SelectField>
      {inOther && (
        <Input
          label="Model id"
          aria-label="Model id"
          value={customText}
          placeholder="e.g. grok-4.7?reasoning_effort=xhigh"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {(chosen?.parameters ?? []).map((p) => (
        <SelectField
          key={p.id}
          label={p.displayName ?? p.id}
          value={selection.params[p.id] ?? ''}
          onChange={(e) =>
            onChange(
              cursorModelSpec(
                chosen!.id,
                '',
                { ...selection.params, [p.id]: e.target.value },
                chosen,
              ),
            )
          }
        >
          <option value="">Default</option>
          {paramValues(p, selection.params[p.id] ?? '').map((v) => (
            <option key={v.value} value={v.value}>
              {v.displayName ?? v.value}
            </option>
          ))}
        </SelectField>
      ))}
    </div>
  )
}
