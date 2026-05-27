/**
 * FILE: apps/admin/src/components/integrations/PlatformIntegrationCard.tsx
 * PURPOSE: One Sentry/Langfuse/GitHub/Cursor card. Pure presentation: shows
 *          service icon, status-coded left border, last probe + sparkline,
 *          external link to the service, and the edit form. Mutations bubble
 *          up to the page via callbacks.
 */

import { useEffect, useRef, useState } from 'react'
import { Card, Btn, Badge, Input, RelativeTime, ResultChip, Tooltip, ErrorAlert } from '../ui'
import { ConfigHelp } from '../ConfigHelp'
import { resolveValidator } from '../../lib/validators'
import { isStale } from '../../lib/staleness'
import { HealthPill } from '../charts'
import { HealthSparkline } from './HealthSparkline'
import { IconPlay, IconPencil, IconExternalLink, IconAlertTriangle } from '../icons'
import { ServiceFavicon } from './ServiceFavicon'
import { InlineProof } from '../report-detail/ReportSurface'
import { ClaudeCodeSetupPanel } from './ClaudeCodeSetupPanel'
import { IntegrationSetupGuide } from './IntegrationSetupGuide'
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

/** Maps probe/config status to a left-border color class on the card. */
function statusBorderClass(status: HealthRow['status'], requiredOk: boolean): string {
  if (!requiredOk) return 'border-l-2 border-l-edge'
  switch (status) {
    case 'ok': return 'border-l-2 border-l-ok/70'
    case 'degraded': return 'border-l-2 border-l-warn/80'
    case 'down': return 'border-l-2 border-l-danger/80'
    default: return 'border-l-2 border-l-edge'
  }
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
  /**
   * When `def.dependsOn` is set, pass `true` here if the dependency is already
   * configured. The card renders a blocking banner with a scroll-to anchor
   * when the dependency is missing.
   */
  dependencyOk?: boolean
  /** Human-readable label of the dependency (e.g. "GitHub (code repo)"). */
  dependencyLabel?: string
  /** Scroll-target ID to jump to the dependency card on the same page. */
  dependencyAnchorId?: string
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
  dependencyOk = true,
  dependencyLabel,
  dependencyAnchorId,
}: Props) {
  const requiredOk = def.fields.filter((f) => f.required).every((f) => config[f.name] != null)
  const status: HealthRow['status'] = !requiredOk ? 'unknown' : (latestProbe?.status ?? 'unknown')
  const pulseClass = useSuccessPulse(latestProbe)
  const isDown = requiredOk && (latestProbe?.status === 'down')
  const isDegraded = requiredOk && (latestProbe?.status === 'degraded')
  // A fix-agent card (Cursor Cloud, Claude Code) depends on GitHub being connected first.
  const hasDependencyBlock = def.dependsOn != null && !dependencyOk

  return (
    <Card className={`p-0 overflow-hidden ${pulseClass} ${statusBorderClass(status, requiredOk)}`}>
      <div className="px-3 pt-3 pb-2">
        {/* Blocking banner — GitHub must be connected before fix agents work */}
        {hasDependencyBlock && (
          <div className="mb-2 flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-2xs text-warn">
            <IconAlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span className="leading-snug">
              <strong>{dependencyLabel ?? 'GitHub'} must be connected first</strong> — this fix agent needs a repo URL and token to open pull requests.{' '}
              {dependencyAnchorId ? (
                <a
                  href={`#${dependencyAnchorId}`}
                  className="font-semibold underline hover:no-underline"
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(dependencyAnchorId)?.scrollIntoView({ behavior: 'smooth' })
                  }}
                >
                  Go to {dependencyLabel ?? 'GitHub'} card ↑
                </a>
              ) : null}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* Left: icon + label + status chips */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Service brand favicon — real brand icon via Google's favicon CDN */}
              <ServiceFavicon
                domain={def.domain}
                label={def.label}
                FallbackIcon={def.Icon}
                colorClass={def.color}
              />
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

            {/* Down/degraded error banner — high-signal inline alert */}
            {(isDown || isDegraded) && latestProbe?.message && (
              <div className={`mt-1.5 flex items-start gap-1.5 rounded-sm px-2 py-1 text-2xs ${isDown ? 'bg-danger/8 border border-danger/20 text-danger' : 'bg-warn/8 border border-warn/20 text-warn'}`}>
                <IconAlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span className="leading-snug font-mono truncate">{latestProbe.message}</span>
              </div>
            )}

            <p className="text-2xs text-fg-secondary mt-1.5 pl-2 border-l border-brand/20 leading-snug">{def.whyItMatters}</p>

            {!requiredOk && def.setupSteps && def.setupSteps.length > 0 && (
              <IntegrationSetupGuide
                label={def.label}
                steps={def.setupSteps}
                consoleUrl={def.consoleUrl}
                consoleLabel={def.consoleLabel}
              />
            )}

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

          {/* Right: probe chip + action buttons */}
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

            {/* External link to the service */}
            <Tooltip content={`Open ${def.label}`}>
              <a
                href={def.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${def.label} in a new tab`}
                className="inline-flex items-center justify-center w-7 h-7 rounded-sm text-fg-faint hover:text-fg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <IconExternalLink size={13} />
              </a>
            </Tooltip>

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
              <Tooltip content={requiredOk ? 'Edit credentials' : 'Configure integration'}>
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

        {/* Probe metadata + sparkline */}
        {(latestProbe || sparkline.length > 0) && (
          <div className="mt-2 flex items-center gap-3 text-2xs text-fg-faint">
            {latestProbe?.checked_at && (
              <span>Last probe <RelativeTime value={latestProbe.checked_at} /></span>
            )}
            {latestProbe?.latency_ms != null && (
              <span className="font-mono">{latestProbe.latency_ms}ms</span>
            )}
            {sparkline.length > 1 && <HealthSparkline rows={sparkline.slice(0, 14)} />}
          </div>
        )}
      </div>

      {isEditing && (
        <div className="mt-0 space-y-2 border-t border-edge-subtle bg-surface-raised/40 px-3 pt-3 pb-3">
          {def.setupSteps && def.setupSteps.length > 0 && (
            <IntegrationSetupGuide
              label={def.label}
              steps={def.setupSteps}
              consoleUrl={def.consoleUrl}
              consoleLabel={def.consoleLabel}
              compact
            />
          )}
          {def.docsUrl && (
            <p className="text-2xs text-fg-faint">
              Need a token?{' '}
              <a
                href={def.docsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand hover:text-brand-hover underline underline-offset-2"
              >
                {def.label} docs <IconExternalLink size={10} className="inline -mt-0.5" />
              </a>
            </p>
          )}
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
                autoComplete={field.type === 'password' ? 'new-password' : 'off'}
              />
              {field.help ? <InlineProof className="mt-1">{field.help}</InlineProof> : null}
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

      {def.kind === 'claude_code_agent' && !isEditing && (
        <ClaudeCodeSetupPanel configured={requiredOk} />
      )}
    </Card>
  )
}
