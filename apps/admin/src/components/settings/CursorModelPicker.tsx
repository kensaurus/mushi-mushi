/**
 * FILE: apps/admin/src/components/settings/CursorModelPicker.tsx
 * PURPOSE: Cursor model picker (review follow-ups, ADR 0032; written so
 *          spend-down and Integrations can adopt it, BL-090). Loads
 *          GET /v1/admin/byok/cursor/models and writes a spec string
 *          (`id` or `id?param=value&…`). keyId asks for that Cursor account;
 *          omit it to use the key the app would use. A failed or empty list
 *          falls back to the text field.
 */

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
  const chosen = list.find((m) => m.id === selection.modelId)
  const visibleLabel = labelled ? label : undefined

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
        value={selection.modelId}
        onChange={(e) => {
          const id = e.target.value
          if (id === CURSOR_MODEL_OTHER)
            onChange(selection.modelId === CURSOR_MODEL_OTHER ? value : '')
          else onChange(id)
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
      {selection.modelId === CURSOR_MODEL_OTHER && (
        <Input
          label="Model id"
          aria-label="Model id"
          value={selection.custom}
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
