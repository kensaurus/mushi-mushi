/**
 * FILE: apps/admin/src/components/integrations/PlatformIntegrationCard.tsx
 * PURPOSE: One Sentry/Langfuse/GitHub card. Pure presentation: shows status
 *          pill, last probe + sparkline, edit form. Mutations bubble up to
 *          the page via callbacks.
 */

import { Card, Btn, Badge, Input, RelativeTime } from '../ui'
import { HealthPill } from '../charts'
import { HealthSparkline } from './HealthSparkline'
import { PLATFORM_STATUS_MAP, type HealthRow, type PlatformDef } from './types'

interface Props {
  def: PlatformDef
  config: Record<string, unknown>
  latestProbe: HealthRow | undefined
  sparkline: HealthRow[]
  isEditing: boolean
  draft: Record<string, string>
  saving: boolean
  testing: boolean
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
  onStartEdit,
  onCancelEdit,
  onChangeField,
  onSave,
  onTest,
}: Props) {
  const requiredOk = def.fields.filter((f) => f.required).every((f) => config[f.name] != null)
  const status: HealthRow['status'] = !requiredOk ? 'unknown' : (latestProbe?.status ?? 'unknown')

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-fg">{def.label}</h3>
            <HealthPill status={PLATFORM_STATUS_MAP[status]} />
            {!requiredOk && (
              <Badge className="bg-warn/10 text-warn border border-warn/30">Not configured</Badge>
            )}
          </div>
          <p className="text-2xs text-fg-muted mt-0.5">{def.whyItMatters}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {requiredOk && (
            <Btn variant="ghost" onClick={onTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test'}
            </Btn>
          )}
          <Btn
            variant={isEditing ? 'ghost' : 'primary'}
            onClick={isEditing ? onCancelEdit : onStartEdit}
          >
            {isEditing ? 'Cancel' : requiredOk ? 'Edit' : 'Configure'}
          </Btn>
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
              <label className="block text-2xs text-fg-muted mb-0.5">
                {field.label}
                {field.required && <span className="text-danger ml-0.5">*</span>}
              </label>
              <Input
                type={field.type ?? 'text'}
                placeholder={field.placeholder}
                value={draft[field.name] ?? ''}
                onChange={(e) => onChangeField(field.name, e.target.value)}
              />
              <p className="text-2xs text-fg-faint mt-0.5">{field.help}</p>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Btn onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Btn>
            <Btn variant="ghost" onClick={onCancelEdit}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
