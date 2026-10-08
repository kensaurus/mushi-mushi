/**
 * FILE: apps/admin/src/components/integrations/RoutingProviderCard.tsx
 * PURPOSE: One Jira/GitHub-Issues/PagerDuty card. Same shape as the
 *          platform card but with pause/resume + disconnect actions and a
 *          Test button that probes the provider's credentials live.
 */

import { Card, Btn, Input, SecretInput, RelativeTime, Tooltip } from '../ui'
import { ConfigHelp } from '../ConfigHelp'
import { resolveValidator } from '../../lib/validators'
import { HealthSparkline } from './HealthSparkline'
import { IconPause, IconPlay, IconPencil, IconClose, IconExternalLink } from '../icons'
import { ServiceFavicon } from './ServiceFavicon'
import { InlineProof } from '../report-detail/ReportSurface'
import type { HealthRow, RoutingIntegration, RoutingProviderDef } from './types'
import { ConnectionStatus } from '../ui/ConnectionStatus'
import { connectionFromProbe } from '../../lib/integrationConnection'
import { ADMIN_ONLY_HINT } from '../../lib/orgPermissions'

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
  /** False for members and viewers: routing writes are owner/admin only. */
  canManage?: boolean
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
  canManage = true,
}: Props) {
  // Status comes only from the probe history. A saved, active row used to read
  // as "ok" with no check at all; that is "not checked yet".
  const probeStatus: HealthRow['status'] = latestProbe?.status ?? 'unknown'
  const probed = connectionFromProbe({ configured: Boolean(existing), probe: latestProbe })
  const paused = Boolean(existing && !existing.is_active)
  const connection = paused
    ? { state: 'attention' as const, detail: 'Paused — new reports are not forwarded here.' }
    : probed
  const probeFailing = latestProbe?.status === 'down' || latestProbe?.status === 'degraded'
  const writes = (label: string, onClick: () => void) => (canManage ? { label, onClick } : undefined)
  const connectionAction = isEditing
    ? undefined
    : connection.state === 'not_connected'
      ? writes('Connect', onStartEdit)
      : paused
        ? writes('Resume', onTogglePause)
        : connection.state === 'checking'
          ? { label: 'Test now', onClick: onTest }
          : connection.state === 'attention'
            ? probeFailing
              ? writes('Edit credentials', onStartEdit)
              : { label: 'Test again', onClick: onTest }
            : undefined

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
            </div>

            <div className="mt-1.5" title={probed.raw && probed.raw !== connection.detail ? probed.raw : undefined}>
              <ConnectionStatus
                state={testing ? 'checking' : connection.state}
                label={testing ? 'Testing…' : undefined}
                detail={testing ? undefined : connection.detail}
                action={testing ? undefined : connectionAction}
              />
            </div>

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
                <Tooltip content={!canManage ? ADMIN_ONLY_HINT : existing.is_active ? 'Pause' : 'Resume'}>
                  <Btn
                    variant="ghost"
                    onClick={onTogglePause}
                    disabled={!canManage}
                    aria-label={existing.is_active ? 'Pause integration' : 'Resume integration'}
                    className="px-2"
                  >
                    {existing.is_active ? <IconPause size={14} /> : <IconPlay size={14} />}
                  </Btn>
                </Tooltip>
                <Tooltip content={canManage ? 'Disconnect' : ADMIN_ONLY_HINT}>
                  <Btn
                    variant="ghost"
                    onClick={onDisconnect}
                    disabled={!canManage}
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
                className="inline-flex items-center justify-center w-7 h-7 rounded-sm text-fg-faint hover:text-fg-muted transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <IconExternalLink size={13} />
              </a>
            </Tooltip>

            {/* Not connected: the status row already carries the one Connect button. */}
            {!isEditing && existing && (
              <Tooltip content={canManage ? 'Edit credentials' : ADMIN_ONLY_HINT}>
                <Btn
                  variant="ghost"
                  onClick={onStartEdit}
                  disabled={!canManage}
                  aria-label="Edit integration"
                  className="px-2"
                >
                  <IconPencil size={14} />
                </Btn>
              </Tooltip>
            )}
            {isEditing && (
              <Btn variant="cancel" onClick={onCancelEdit}>
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
              {field.type === 'password' ? (
                // type="text" + CSS mask: password managers never offer to
                // save a routing token as the site login.
                <SecretInput
                  placeholder={field.placeholder}
                  value={draft[field.name] ?? ''}
                  onChange={(e) => onChangeField(field.name, e.target.value)}
                  validate={resolveValidator(field.validator)}
                />
              ) : (
                <Input
                  type={field.type ?? 'text'}
                  placeholder={field.placeholder}
                  value={draft[field.name] ?? ''}
                  onChange={(e) => onChangeField(field.name, e.target.value)}
                  validate={resolveValidator(field.validator)}
                  autoComplete="off"
                />
              )}
              {field.help ? <InlineProof className="mt-1">{field.help}</InlineProof> : null}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Btn onClick={onSave} disabled={saving} loading={saving}>
              Save
            </Btn>
            <Btn variant="cancel" onClick={onCancelEdit}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
