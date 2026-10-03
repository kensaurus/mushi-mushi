/**
 * FILE: apps/admin/src/components/settings/SpendLimitsPanel.tsx
 * PURPOSE: Settings → General → Spend limits. Edits the monthly AI budget and
 *          the auto-fix limits through PATCH /v1/admin/settings (project
 *          admins only; the server re-validates every value).
 *
 *          The limits bound what Mushi spends on its own. A fix a person
 *          starts runs past the spend and daily limits, but the approval
 *          threshold applies to every fix. The monthly AI budget stops all AI
 *          calls for the project until the 1st (UTC).
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ErrorAlert, Input, Section } from '../ui'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsCard } from './SettingsPanelLayout'
import {
  buildLimitsPatch,
  formatLimit,
  SPEND_LIMITS,
  type SpendLimitField,
  type SpendLimitValues,
} from './spendLimits'

export function SpendLimitsPanel() {
  const toast = useToast()
  const [saved, setSaved] = useState<SpendLimitValues | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Partial<Record<SpendLimitField, string>>>({})
  const [errors, setErrors] = useState<Partial<Record<SpendLimitField, string>>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await apiFetch<SpendLimitValues>('/v1/admin/settings')
    if (res.ok) setSaved(res.data ?? {})
    else setLoadError(res.error?.message ?? 'Could not load the spend limits')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const valueOf = (field: SpendLimitField) => drafts[field] ?? formatLimit(saved?.[field])
  const changeCount = SPEND_LIMITS.filter(
    (m) => drafts[m.field] !== undefined && drafts[m.field] !== formatLimit(saved?.[m.field]),
  ).length
  const dirty = changeCount > 0

  function discard() {
    setDrafts({})
    setErrors({})
  }

  async function save() {
    const { patch, errors: found } = buildLimitsPatch(drafts, saved ?? {})
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (Object.keys(patch).length === 0) {
      discard()
      return
    }
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) })
    setSaving(false)
    if (res.ok) {
      toast.success('Spend limits saved')
      setSaved({ ...(saved ?? {}), ...patch })
      discard()
    } else {
      toast.error('Could not save the spend limits', res.error?.message)
    }
  }

  if (loadError) return <ErrorAlert message={loadError} onRetry={() => void load()} />
  if (!saved) return null

  return (
    <div id="spend-limits" className="space-y-3">
      <Section title="Spend limits" className="space-y-3">
        <p className="text-2xs text-fg-muted">
          Caps on what this project spends. Mushi stops when a limit is reached and says why on the report or fix.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {SPEND_LIMITS.map((m) => (
            <SettingsCard key={m.field}>
              <Input
                id={`spend-limit-${m.field}`}
                label={m.label}
                inputMode={m.unit === 'usd' ? 'decimal' : 'numeric'}
                placeholder={m.placeholder}
                value={valueOf(m.field)}
                error={errors[m.field]}
                onChange={(e) => {
                  const next = e.target.value
                  setDrafts((d) => ({ ...d, [m.field]: next }))
                  setErrors((er) => ({ ...er, [m.field]: undefined }))
                }}
              />
              <p className="text-2xs text-fg-muted">{m.help}</p>
            </SettingsCard>
          ))}
        </div>
      </Section>
      <SettingsFormFooter
        dirty={dirty}
        saving={saving}
        changeCount={changeCount}
        onSave={() => void save()}
        onDiscard={discard}
        saveLabel="Save spend limits"
      />
    </div>
  )
}
