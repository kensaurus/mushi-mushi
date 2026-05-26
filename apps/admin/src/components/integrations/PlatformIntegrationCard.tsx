/**
 * FILE: apps/admin/src/components/integrations/PlatformIntegrationCard.tsx
 * PURPOSE: One Sentry/Langfuse/GitHub card. Pure presentation: shows status
 *          pill, last probe + sparkline, edit form. Mutations bubble up to
 *          the page via callbacks.
 */

import { useEffect, useRef, useState } from 'react'
import { Card, Btn, Badge, Input, RelativeTime, ResultChip, Tooltip, ErrorAlert } from '../ui'
import { ConfigHelp } from '../ConfigHelp'
import { resolveValidator } from '../../lib/validators'
import { isStale } from '../../lib/staleness'
import { HealthPill } from '../charts'
import { HealthSparkline } from './HealthSparkline'
import { IconPlay, IconPencil } from '../icons'
import { PLATFORM_STATUS_MAP, type HealthRow, type PlatformDef } from './types'

/**
 * Triggers a one-shot success-pulse signal when the latest probe transitions
 * to `ok` (so the card border briefly glows green and the user's eye is
 * pulled to the receipt). Returns a string class to drop on the wrapper.
 *
 * Implementation note: we key on the probe's `checked_at` timestamp so the
 * pulse fires every time a fresh successful probe lands — not just on the
 * first ok. Status flips from non-ok → ok also pulse, but a sustained run
 * of ok probes refreshes the visual feedback so users hammering "Test"
 * still see something happen each click.
 */
function useSuccessPulse(probe: HealthRow | undefined): string {
  const [pulsing, setPulsing] = useState(false)
  const lastSeenAt = useRef<string | null>(null)
  // Track whether we've completed the initial baseline read so the very first
  // render with an `ok` probe doesn't trigger a phantom celebration (the user
  // just navigated here — nothing successful just happened in front of them).
  // Subsequent renders with a different `checked_at` are real probe refreshes
  // and SHOULD pulse, including repeated Test-button clicks.
  const initialised = useRef(false)
  useEffect(() => {
    if (!probe) return
    if (probe.status !== 'ok') {
      lastSeenAt.current = probe.checked_at ?? null
      initialised.current = true
      return
    }
    const at = probe.checked_at ?? null
    if (!initialised.current) {
      lastSeenAt.current = at
      initialised.current = true
      return
    }
    if (at && at !== lastSeenAt.current) {
      lastSeenAt.current = at
      setPulsing(true)
      const t = setTimeout(() => setPulsing(false), 650)
      return () => clearTimeout(t)
    }
  }, [probe?.status, probe?.checked_at])
  return pulsing ? 'text-ok motion-safe:animate-mushi-success-pulse rounded-md' : ''
}

interface Props {
  def: PlatformDef
  config: Record<string, unknown>
  latestProbe: HealthRow | undefined
  sparkline: HealthRow[]
  isEditing: boolean
  draft: Record<string, string>
  saving: boolean
  testing: boolean
  /** Pinned error from the last failed save — rendered inside the card so it
   *  survives after the toast auto-dismisses. Cleared on the next successful save. */
  inlineError?: string | null
  onStartEdit: () => void
  onCancelEdit: () => void
  onChangeField: (name: string, value: string) => void
  onSave: () => void
  onTest: () => void
}

export function PlatformIntegrationCard({
  def,
  config,
  latestProbe,
  sparkline,
  isEditing,
  draft,
  saving,
  testing,
  inlineError,
  onStartEdit,
  onCancelEdit,
  onChangeField,
  onSave,
  onTest,
}: Props) {
  const requiredOk = def.fields.filter((f) => f.required).every((f) => config[f.name] != null)
  const status: HealthRow['status'] = !requiredOk ? 'unknown' : (latestProbe?.status ?? 'unknown')
  const pulseClass = useSuccessPulse(latestProbe)

  return (
    <Card className={`p-3 ${pulseClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-fg">{def.label}</h3>
            <HealthPill status={PLATFORM_STATUS_MAP[status]} />
            {!requiredOk && (
              <Badge className="bg-warn/10 text-warn border border-warn/30">Not configured</Badge>
            )}
            {requiredOk && latestProbe?.checked_at && isStale(latestProbe.checked_at) && (
              <Tooltip content="Auto-probe runs every 15 min. Click Test to refresh now.">
                <Badge className="bg-warn/10 text-warn border border-warn/30">Stale</Badge>
              </Tooltip>
            )}
          </div>
          <p className="text-2xs text-fg-secondary mt-1 pl-2 border-l-2 border-brand/30 leading-snug">{def.whyItMatters}</p>
          {!requiredOk && def.capabilitiesOnceConnected.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-2xs">
              {def.capabilitiesOnceConnected.map((capability) => (
                <li key={capability} className="flex gap-1.5 items-baseline">
                  <span aria-hidden="true" className="shrink-0 text-ok font-semibold leading-tight">✓</span>
                  <span className="text-fg-secondary leading-snug">{capability}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {requiredOk && testing && (
            <ResultChip tone="running">Testing…</ResultChip>
          )}
          {requiredOk && !testing && latestProbe && (
            <ResultChip
              tone={latestProbe.status === 'ok' ? 'success' : latestProbe.status === 'degraded' ? 'info' : 'error'}
              at={latestProbe.checked_at}
            >
              {latestProbe.status === 'ok'
                ? 'Connection OK'
                : latestProbe.status === 'degraded'
                  ? 'Degraded'
                  : latestProbe.message ?? 'Failed'}
            </ResultChip>
          )}
          {requiredOk && (
            <Tooltip content={testing ? 'Testing…' : 'Test connection'}>
              <Btn
                variant="ghost"
                onClick={onTest}
                disabled={testing}
                loading={testing}
                aria-label="Test connection"
                className="px-2"
              >
                <IconPlay size={14} />
              </Btn>
            </Tooltip>
          )}
          {!isEditing && (
            <Tooltip content={requiredOk ? 'Edit' : 'Configure'}>
              <Btn
                variant={requiredOk ? 'ghost' : 'primary'}
                onClick={onStartEdit}
                aria-label={requiredOk ? 'Edit integration' : 'Configure integration'}
                className={requiredOk ? 'px-2' : undefined}
              >
                {requiredOk ? <IconPencil size={14} /> : 'Configure'}
              </Btn>
            </Tooltip>
          )}
          {isEditing && (
            <Btn variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Btn>
          )}
        </div>
      </div>

      {(latestProbe || sparkline.length > 0) && (
        <div className="mt-2 flex items-center gap-3 text-2xs text-fg-muted">
          {latestProbe?.checked_at && (
            <span>Last probe <RelativeTime value={latestProbe.checked_at} /></span>
          )}
          {latestProbe?.latency_ms != null && (
            <span className="font-mono">{latestProbe.latency_ms}ms</span>
          )}
          {latestProbe?.message && (
            <span className="font-mono truncate" title={latestProbe.message}>
              {latestProbe.message}
            </span>
          )}
          {sparkline.length > 1 && <HealthSparkline rows={sparkline.slice(0, 14)} />}
        </div>
      )}

      {isEditing && (
        <div className="mt-3 space-y-2 border-t border-edge-subtle pt-3">
          {def.fields.map((field) => (
            <div key={field.name}>
              <label className="text-2xs text-fg-muted mb-0.5 flex items-center gap-1">
                <span>
                  {field.label}
                  {field.required && <span className="text-danger ml-0.5">*</span>}
                </span>
                {field.helpId && <ConfigHelp helpId={field.helpId} />}
              </label>
              <Input
                type={field.type ?? 'text'}
                placeholder={field.placeholder}
                value={draft[field.name] ?? ''}
                onChange={(e) => onChangeField(field.name, e.target.value)}
                validate={resolveValidator(field.validator)}
              />
              <p className="text-2xs text-fg-faint mt-0.5">{field.help}</p>
            </div>
          ))}
          {inlineError && (
            <ErrorAlert title="Save failed" message={inlineError} />
          )}
          <div className="flex items-center gap-2 pt-1">
            <Btn onClick={onSave} disabled={saving} loading={saving}>
              Save
            </Btn>
            <Btn variant="ghost" onClick={onCancelEdit}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
