/**
 * FILE: apps/admin/src/components/integrations/RoutingProviderCard.tsx
 * PURPOSE: One Jira/Linear/GitHub-Issues/PagerDuty card. Same shape as the
 *          platform card but with pause/resume + disconnect actions and a
 *          Test button that probes the provider's credentials live.
 */

import { Card, Btn, Badge, Input, RelativeTime, ResultChip, Tooltip } from '../ui'
import { HealthPill } from '../charts'
import { ConfigHelp } from '../ConfigHelp'
import { resolveValidator } from '../../lib/validators'
import { isStale } from '../../lib/staleness'
import { HealthSparkline } from './HealthSparkline'
import { IconPause, IconPlay, IconPencil, IconClose, IconExternalLink, IconAlertTriangle } from '../icons'
import { ServiceFavicon } from './ServiceFavicon'
import { InlineProof } from '../report-detail/ReportSurface'
import { PLATFORM_STATUS_MAP, type HealthRow, type RoutingIntegration, type RoutingProviderDef } from './types'

/** Maps probe status to a left-border color class on the card. */
function statusBorderClass(status: HealthRow['status'], isConnected: boolean): string {
  if (!isConnected) return 'border-l-2 border-l-edge'
  switch (status) {
    case 'ok': return 'border-l-2 border-l-ok/70'
    case 'degraded': return 'border-l-2 border-l-warn/80'
    case 'down': return 'border-l-2 border-l-danger/80'
    default: return 'border-l-2 border-l-edge'
  }
}

interface Props {
  provider: RoutingProviderDef
  existing: RoutingIntegration | undefined
  isEditing: boolean
  draft: Record<string, string>
  saving: boolean
  testing: boolean
  latestProbe: HealthRow | undefined
  sparkline: HealthRow[]
  onStartEdit: () => void
  onCancelEdit: () => void
  onChangeField: (name: string, value: string) => void
  onSave: () => void
  onTest: () => void
  onTogglePause: () => void
  onDisconnect: () => void
}

export function RoutingProviderCard({
  provider,
  existing,
  isEditing,
  draft,
  saving,
  testing,
  latestProbe,
  sparkline,
  onStartEdit,
  onCancelEdit,
  onChangeField,
  onSave,
  onTest,
  onTogglePause,
  onDisconnect,
}: Props) {
  // Status comes from the probe history when available; otherwise fall back to
  // is_active for a coarse connected/not-connected signal.
  const probeStatus: HealthRow['status'] = latestProbe?.status ?? (existing?.is_active ? 'ok' : 'unknown')
  const isDown = existing && latestProbe?.status === 'down'
  const isDegraded = existing && latestProbe?.status === 'degraded'

  return (
    <Card className={`p-0 overflow-hidden ${statusBorderClass(probeStatus, !!existing)}`}>
      <div className="px-3 pt-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* Left: icon + label + status chips */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Service brand favicon — real brand icon via Google's favicon CDN */}
              <ServiceFavicon
                domain={provider.domain}
                label={provider.label}
                FallbackIcon={provider.Icon}
                colorClass={provider.color}
              />
              <h3 className="text-sm font-semibold text-fg">{provider.label}</h3>
              <HealthPill status={existing ? PLATFORM_STATUS_MAP[probeStatus] : undefined} />
              {existing && !existing.is_active && (
                <Badge className="bg-warn/10 text-warn border border-warn/30">Paused</Badge>
              )}
              {existing && latestProbe?.checked_at && isStale(latestProbe.checked_at) && (
                <Tooltip content="Auto-probe runs every 15 min. Click Test to refresh now.">
                  <Badge className="bg-warn/10 text-warn border border-warn/30">Stale</Badge>
                </Tooltip>
              )}
            </div>

            {/* Down/degraded error banner */}
            {(isDown || isDegraded) && latestProbe?.message && (
              <div className={`mt-1.5 flex items-start gap-1.5 rounded-sm px-2 py-1 text-2xs ${isDown ? 'bg-danger/8 border border-danger/20 text-danger' : 'bg-warn/8 border border-warn/20 text-warn'}`}>
                <IconAlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span className="leading-snug font-mono truncate">{latestProbe.message}</span>
              </div>
            )}

            <p className="text-2xs text-fg-secondary mt-1.5 pl-2 border-l border-brand/20 leading-snug">{provider.whyItMatters}</p>
            {!existing && provider.capabilitiesOnceConnected.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-2xs">
                {provider.capabilitiesOnceConnected.map((capability) => (
                  <li key={capability} className="flex gap-1.5 items-baseline">
                    <span aria-hidden="true" className="shrink-0 text-ok font-semibold leading-tight">✓</span>
                    <span className="text-fg-secondary leading-snug">{capability}</span>
                  </li>
                ))}
              </ul>
            )}
            {existing?.last_synced_at && (
              <p className="text-2xs text-fg-faint mt-0.5">
                Last sync <RelativeTime value={existing.last_synced_at} />
              </p>
            )}
          </div>

          {/* Right: probe chip + action buttons */}
          <div className="flex items-center gap-1.5">
            {existing && (
              <>
                {testing && (
                  <ResultChip tone="running">Testing…</ResultChip>
                )}
                {existing && !testing && latestProbe && (
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
                <Tooltip content={existing.is_active ? 'Pause' : 'Resume'}>
                  <Btn
                    variant="ghost"
                    onClick={onTogglePause}
                    aria-label={existing.is_active ? 'Pause integration' : 'Resume integration'}
                    className="px-2"
                  >
                    {existing.is_active ? <IconPause size={14} /> : <IconPlay size={14} />}
                  </Btn>
                </Tooltip>
                <Tooltip content="Disconnect">
                  <Btn
                    variant="ghost"
                    onClick={onDisconnect}
                    aria-label="Disconnect integration"
                    className="px-2 text-fg-muted hover:text-danger"
                  >
                    <IconClose size={14} />
                  </Btn>
                </Tooltip>
              </>
            )}

            {/* External link to the service */}
            <Tooltip content={`Open ${provider.label}`}>
              <a
                href={provider.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${provider.label} in a new tab`}
                className="inline-flex items-center justify-center w-7 h-7 rounded-sm text-fg-faint hover:text-fg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <IconExternalLink size={13} />
              </a>
            </Tooltip>

            {!isEditing && (
              <Tooltip content={existing ? 'Edit credentials' : 'Connect'}>
                <Btn
                  variant={existing ? 'ghost' : 'primary'}
                  onClick={onStartEdit}
                  aria-label={existing ? 'Edit integration' : 'Connect integration'}
                  className={existing ? 'px-2' : undefined}
                >
                  {existing ? <IconPencil size={14} /> : 'Connect'}
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
          {provider.fields.map((field) => (
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
              {field.help ? <InlineProof className="mt-1">{field.help}</InlineProof> : null}
            </div>
          ))}
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
