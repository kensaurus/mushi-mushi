/**
 * FILE: apps/admin/src/components/FunnelBuilder.tsx
 * PURPOSE: Ordered-step funnel editor for the Users & Funnels page.
 *
 *          Pick events from the project's top events (chips), reorder or
 *          remove them, choose a conversion window and an optional
 *          breakdown property, then Run. Saved funnels live in localStorage
 *          per project (`lib/funnelBuilder.ts`, v1) and the
 *          "Signup → Activated" preset is always one click away.
 *
 *          All list/ordering rules are in `lib/funnelBuilder.ts` (pure,
 *          tested); this file is UI only.
 */

import { useState, type FormEvent } from 'react'
import { Btn, Card, Input, SelectField } from './ui'
import { ContainedBlock } from './report-detail/ReportSurface'
import { CHIP_TONE } from '../lib/chipTone'
import {
  FUNNEL_MAX_STEPS,
  FUNNEL_WINDOWS,
  SIGNUP_ACTIVATED_PRESET,
  addStep,
  canRunFunnel,
  isValidEventName,
  moveStep,
  removeStep,
  type FunnelDefinition,
  type FunnelWindow,
} from '../lib/funnelBuilder'

interface FunnelBuilderProps {
  value: FunnelDefinition
  onChange: (next: FunnelDefinition) => void
  onRun: () => void
  running?: boolean
  /** Event names seen in the window — from `summary.top_events`. */
  availableEvents: string[]
  saved: FunnelDefinition[]
  onSave: (def: FunnelDefinition) => void
  onLoad: (def: FunnelDefinition) => void
  onDelete: (id: string) => void
}

// CHIP_TONE recipes carry their own border; this only sets shape + type.
const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-mono motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'

export function FunnelBuilder({
  value,
  onChange,
  onRun,
  running = false,
  availableEvents,
  saved,
  onSave,
  onLoad,
  onDelete,
}: FunnelBuilderProps) {
  const [customEvent, setCustomEvent] = useState('')
  const [saveName, setSaveName] = useState(value.name)

  const steps = value.steps
  const full = steps.length >= FUNNEL_MAX_STEPS
  const runnable = canRunFunnel(steps)
  const pickable = availableEvents.filter((name) => !steps.includes(name))

  function setSteps(next: string[]) {
    onChange({ ...value, steps: next })
  }

  function addCustom(e: FormEvent) {
    e.preventDefault()
    const name = customEvent.trim()
    if (!isValidEventName(name)) return
    setSteps(addStep(steps, name))
    setCustomEvent('')
  }

  function save() {
    const name = saveName.trim() || `Funnel ${saved.length + 1}`
    onSave({ ...value, name })
    setSaveName(name)
  }

  return (
    <Card className="p-4 space-y-4">
      {/* Ordered steps */}
      <div data-testid="funnel-builder">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-fg">Steps, in order</p>
          <span className="text-2xs tabular-nums text-fg-faint">
            {steps.length}/{FUNNEL_MAX_STEPS}
          </span>
        </div>
        {steps.length === 0 ? (
          <ContainedBlock tone="muted">
            <p className="text-xs text-fg-muted">
              Pick two or more events below. The order you add them is the order people must do them.
            </p>
          </ContainedBlock>
        ) : (
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Funnel steps">
            {steps.map((name, i) => (
              <li key={name} className="flex items-center gap-1">
                {i > 0 && <span className="text-fg-faint text-xs" aria-hidden="true">→</span>}
                <span className={`${CHIP_BASE} ${CHIP_TONE.brandSubtle}`}>
                  <span className="tabular-nums text-fg-faint">{i + 1}</span>
                  <span>{name}</span>
                  <button
                    type="button"
                    onClick={() => setSteps(moveStep(steps, i, i - 1))}
                    disabled={i === 0}
                    aria-label={`Move ${name} earlier`}
                    className="px-0.5 text-fg-faint hover:text-fg disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setSteps(moveStep(steps, i, i + 1))}
                    disabled={i === steps.length - 1}
                    aria-label={`Move ${name} later`}
                    className="px-0.5 text-fg-faint hover:text-fg disabled:opacity-30"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    onClick={() => setSteps(removeStep(steps, i))}
                    aria-label={`Remove ${name}`}
                    className="px-0.5 text-fg-faint hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Event picker */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-fg">Add a step</p>
        {pickable.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="Events seen in this window">
            {pickable.map((name) => (
              <button
                key={name}
                type="button"
                role="listitem"
                disabled={full}
                onClick={() => setSteps(addStep(steps, name))}
                className={`${CHIP_BASE} ${CHIP_TONE.neutral} hover:text-fg disabled:opacity-40`}
                title={full ? `Funnels take at most ${FUNNEL_MAX_STEPS} steps` : `Add ${name}`}
              >
                + {name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-fg-faint">
            {availableEvents.length === 0
              ? 'No events in this window yet — type one below or wait for the first Mushi.track() call.'
              : 'Every event seen in this window is already in the funnel.'}
          </p>
        )}
        <form onSubmit={addCustom} className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Or type an event name"
              id="funnel-custom-event"
              value={customEvent}
              onChange={(e) => setCustomEvent(e.target.value)}
              placeholder="checkout_started"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              validate={(v) =>
                v && !isValidEventName(v.trim())
                  ? { message: 'lowercase letters, digits, and underscores; 2–64 chars', severity: 'warn' }
                  : null
              }
            />
          </div>
          <Btn type="submit" size="sm" variant="ghost" disabled={full || !isValidEventName(customEvent.trim())}>
            Add
          </Btn>
        </form>
      </div>

      {/* Window + breakdown + run */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <SelectField
            label="Conversion window"
            id="funnel-window"
            value={value.window}
            onChange={(e) => onChange({ ...value, window: e.target.value as FunnelWindow })}
          >
            {FUNNEL_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="min-w-48 flex-1">
          <Input
            label="Break down by property (optional)"
            id="funnel-breakdown"
            value={value.breakdown ?? ''}
            onChange={(e) => onChange({ ...value, breakdown: e.target.value.trim() || null })}
            placeholder="plan"
            autoComplete="off"
            className="font-mono"
          />
        </div>
        <Btn
          size="md"
          variant="primary"
          onClick={onRun}
          loading={running}
          disabled={!runnable || running}
          title={!runnable ? 'Add at least two steps' : undefined}
          data-testid="funnel-run"
        >
          Run funnel
        </Btn>
      </div>

      {/* Presets + saved */}
      <div className="flex flex-wrap items-end gap-3 border-t border-edge-subtle pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-fg-faint">Presets:</span>
          <button
            type="button"
            onClick={() => onLoad(SIGNUP_ACTIVATED_PRESET)}
            className={`${CHIP_BASE} ${CHIP_TONE.infoSubtle} hover:text-fg`}
          >
            {SIGNUP_ACTIVATED_PRESET.name}
          </button>
          {saved.map((def) => (
            <span key={def.id} className={`${CHIP_BASE} ${CHIP_TONE.neutral}`}>
              <button type="button" onClick={() => onLoad(def)} className="hover:text-fg">
                {def.name}
              </button>
              <button
                type="button"
                onClick={() => onDelete(def.id)}
                aria-label={`Delete saved funnel ${def.name}`}
                className="px-0.5 text-fg-faint hover:text-danger"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-end gap-2">
          <Input
            label="Save as"
            id="funnel-save-name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Checkout"
            autoComplete="off"
          />
          <Btn size="sm" variant="ghost" onClick={save} disabled={!runnable}>
            Save
          </Btn>
        </div>
      </div>
    </Card>
  )
}
