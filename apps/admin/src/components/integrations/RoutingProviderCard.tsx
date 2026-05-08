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
import { IconPause, IconPlay, IconPencil, IconClose } from '../icons'
import { PLATFORM_STATUS_MAP, type HealthRow, type RoutingIntegration, type RoutingProviderDef } from './types'

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

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
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
          <p className="text-2xs text-fg-secondary mt-1 pl-2 border-l-2 border-brand/30 leading-snug">{provider.whyItMatters}</p>
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
          {!isEditing && (
            <Tooltip content={existing ? 'Edit' : 'Connect'}>
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
              <p className="text-2xs text-fg-faint mt-0.5">{field.help}</p>
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
