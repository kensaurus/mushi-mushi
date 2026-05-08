/**
 * FILE: apps/admin/src/components/integrations/RoutingProviderCard.tsx
 * PURPOSE: One Jira/Linear/GitHub-Issues/PagerDuty card. Same shape as the
 *          platform card but with pause/resume + disconnect actions.
 */

import { Card, Btn, Badge, Input, RelativeTime, Tooltip } from '../ui'
import { HealthPill } from '../charts'
import { ConfigHelp } from '../ConfigHelp'
import { resolveValidator } from '../../lib/validators'
import { IconPause, IconPlay, IconPencil, IconClose } from '../icons'
import { PLATFORM_STATUS_MAP, type RoutingIntegration, type RoutingProviderDef } from './types'

interface Props {
  provider: RoutingProviderDef
  existing: RoutingIntegration | undefined
  isEditing: boolean
  draft: Record<string, string>
  saving: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onChangeField: (name: string, value: string) => void
  onSave: () => void
  onTogglePause: () => void
  onDisconnect: () => void
}

export function RoutingProviderCard({
  provider,
  existing,
  isEditing,
  draft,
  saving,
  onStartEdit,
  onCancelEdit,
  onChangeField,
  onSave,
  onTogglePause,
  onDisconnect,
}: Props) {
  const status: 'ok' | 'unknown' = existing?.is_active ? 'ok' : 'unknown'

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-fg">{provider.label}</h3>
            <HealthPill status={existing ? PLATFORM_STATUS_MAP[status] : undefined} />
            {existing && !existing.is_active && (
              <Badge className="bg-warn/10 text-warn border border-warn/30">Paused</Badge>
            )}
          </div>
          <p className="text-2xs text-fg-muted mt-0.5">{provider.whyItMatters}</p>
          {!existing && provider.capabilitiesOnceConnected.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-2xs text-fg-muted">
              {provider.capabilitiesOnceConnected.map((capability) => (
                <li key={capability} className="flex gap-1.5">
                  <span aria-hidden="true" className="text-fg-faint">+</span>
                  <span>{capability}</span>
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
