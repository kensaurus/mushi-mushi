/**
 * FILE: apps/admin/src/components/settings/CiCostSettingsCard.tsx
 * PURPOSE: Settings → General → "CI cost" (Plan 022 Phase 7, ADR 0037).
 *          The figures behind /ci "Cost and speed", per organization: your
 *          GitHub plan and its included minutes, electricity (idle and load
 *          watts, price per kWh, currency), wear per busy hour, GitHub's
 *          self-hosted fee (0 while it is postponed), and which runners share
 *          one physical machine.
 *
 *          GET / PUT /v1/admin/ci/cost-settings (`?project_id=` picks the
 *          active app's organization). Saving is console-only; viewers and
 *          API keys read it. Until the database update is applied the card
 *          shows the example figures and says it cannot save yet.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import type { CiCompareSettings, CiCostSettingsResponse } from '../../lib/ciCompareTypes'
import {
  costSettingsBody,
  draftFromCostSettings,
  PLAN_INCLUDED_MINUTES,
  validateCostDraft,
  type CostDraft,
  type CostErrors,
} from '../../lib/ciCompareView'
import { ErrorAlert, Input, ResultChip, SelectField, Textarea } from '../ui'
import { IconBolt, IconCost, IconGithub, IconServer } from '../icons'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsList, SettingsRow } from './SettingsRow'
import { SETTINGS_SECTION_IDS } from '../../lib/settingsTabs'

const CI_COST_SECTION_ID = SETTINGS_SECTION_IDS.ciCost

const PLAN_LABEL: Record<CiCompareSettings['plan'], string> = {
  free: 'Free (2,000 minutes)',
  pro: 'Pro (3,000 minutes)',
  team: 'Team (3,000 minutes)',
  enterprise: 'Enterprise Cloud (50,000 minutes)',
  custom: 'Custom',
}

export function CiCostSettingsCard({ projectId }: { projectId: string | null }) {
  const path = projectId ? `/v1/admin/ci/cost-settings?project_id=${encodeURIComponent(projectId)}` : '/v1/admin/ci/cost-settings'
  const page = usePageData<CiCostSettingsResponse>(path)
  const [edits, setEdits] = useState<CostDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState<CiCostSettingsResponse | null>(null)

  const data = saved ?? page.data
  if (!data) {
    return (
      <SettingsList title="CI cost" id={CI_COST_SECTION_ID}>
        <div className="py-3">
          {page.loading ? (
            <p className="text-sm text-fg-muted">Loading CI cost settings…</p>
          ) : (
            <ErrorAlert title="CI cost" message={page.errorMessage ?? page.error ?? 'Could not load the CI cost settings.'} onRetry={page.reload} />
          )}
        </div>
      </SettingsList>
    )
  }

  const readOnly = !data.canEdit
  const draft = edits ?? draftFromCostSettings(data.settings)
  const errors: CostErrors = edits ? validateCostDraft(edits, data.bounds) : {}
  const hasErrors = Object.keys(errors).length > 0
  const dirty = edits !== null

  function change<K extends keyof CostDraft>(key: K, value: CostDraft[K]) {
    const next = { ...draft, [key]: value }
    // Picking a plan fills in its included minutes; Custom keeps what is there.
    if (key === 'plan' && value !== 'custom') next.includedMinutes = String(PLAN_INCLUDED_MINUTES[value as Exclude<CiCompareSettings['plan'], 'custom'>])
    setEdits(next)
    setSaveError(null)
    setNotice(null)
  }

  async function save() {
    if (!edits || hasErrors || !data) return
    setSaving(true)
    const res = await apiFetch<CiCostSettingsResponse>('/v1/admin/ci/cost-settings', {
      method: 'PUT',
      body: JSON.stringify(costSettingsBody(data.settings.organizationId, edits)),
    })
    setSaving(false)
    if (!res.ok || !res.data) {
      setSaveError(res.error?.message ?? 'Mushi did not save the CI cost settings. Try again in a moment.')
      return
    }
    setSaved(res.data)
    setEdits(null)
    setNotice('Saved. /ci uses these figures from the next load.')
    page.reload()
  }

  const usd = draft.currency.trim() === 'USD'
  return (
    <div data-testid="ci-cost-settings-card" className="space-y-2">
      <SettingsList
        title="CI cost"
        id={CI_COST_SECTION_ID}
        description="The figures behind “Cost and speed” on CI runners. They only change the estimates; nothing here changes where your CI runs."
      >
        {!data.writable && (
          <p className="py-2 text-sm text-fg-muted" data-testid="ci-cost-not-writable">
            These are example figures. Saving your own becomes possible after the next database update.
          </p>
        )}
        {data.writable && readOnly && (
          <p className="py-2 text-sm text-fg-muted" data-testid="ci-cost-readonly">
            You can read these figures; an owner, admin or member changes them in the console.
          </p>
        )}

        <SettingsRow
          icon={<IconGithub size={16} />}
          title="GitHub plan"
          purpose="Included minutes are per GitHub account and shared by its private repositories. Public repositories never use them."
        >
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <SelectField label="Plan" value={draft.plan} disabled={readOnly || !data.writable} onChange={(e) => change('plan', e.target.value as CiCompareSettings['plan'])}>
              {data.plans.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </SelectField>
            <Input
              label="Included minutes a month"
              type="number"
              inputMode="numeric"
              min={data.bounds.includedMinutes.min}
              max={data.bounds.includedMinutes.max}
              value={draft.includedMinutes}
              disabled={readOnly || !data.writable || draft.plan !== 'custom'}
              error={errors.includedMinutes}
              onChange={(e) => change('includedMinutes', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconBolt size={16} />}
          title="Electricity"
          purpose="Your machine draws idle power anyway, so CI costs only the extra draw while a job runs: (load − idle) watts × busy hours × your price."
        >
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <Input label="Idle draw (W)" type="number" inputMode="decimal" min={0} value={draft.wattsIdle} disabled={readOnly || !data.writable} error={errors.wattsIdle} onChange={(e) => change('wattsIdle', e.target.value)} />
            <Input label="Draw under load (W)" type="number" inputMode="decimal" min={0} value={draft.wattsLoad} disabled={readOnly || !data.writable} error={errors.wattsLoad} onChange={(e) => change('wattsLoad', e.target.value)} />
            <Input label="Currency" value={draft.currency} maxLength={3} disabled={readOnly || !data.writable} error={errors.currency} onChange={(e) => change('currency', e.target.value.toUpperCase())} tooltip="A 3-letter code: USD, JPY, EUR…" />
            <Input
              label={`Price per kWh (${draft.currency || 'USD'})`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.pricePerKwh}
              disabled={readOnly || !data.writable}
              error={errors.pricePerKwh}
              onChange={(e) => change('pricePerKwh', e.target.value)}
            />
            {!usd && (
              <Input
                label={`${draft.currency || '…'} per US dollar`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={draft.fxPerUsd}
                disabled={readOnly || !data.writable}
                error={errors.fxPerUsd}
                onChange={(e) => change('fxPerUsd', e.target.value)}
                tooltip="GitHub prices are in US dollars; Mushi converts them with this rate."
              />
            )}
            <Input
              label={`Wear per busy hour (${draft.currency || 'USD'})`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.wearPerHour}
              disabled={readOnly || !data.writable}
              error={errors.wearPerHour}
              onChange={(e) => change('wearPerHour', e.target.value)}
              tooltip="Optional: what the machine cost ÷ the hours you expect it to work. 0 leaves it out."
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconServer size={16} />}
          title="Machines"
          purpose="Runners on one physical machine share its electricity. Group them so busy time counts once. Hosts that send a heartbeat from WSL2 on the same PC are grouped already."
        >
          <div className="max-w-xl">
            <Textarea
              label="One machine per line"
              rows={3}
              value={draft.machines}
              placeholder={'Alienware: aw-, alienware-\nNUC (15-65 W): kensaurus-local-'}
              disabled={readOnly || !data.writable}
              error={errors.machines}
              onChange={(e) => change('machines', e.target.value)}
              tooltip="Name, then runner names or name prefixes after a colon. Add (idle-load W) after the name to use that machine's own watts."
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconCost size={16} />}
          title="GitHub's self-hosted fee"
          purpose="GitHub announced $0.002 a minute for self-hosted runners and then postponed it. Leave 0 unless your bill shows it."
        >
          <div className="max-w-xs">
            <Input
              label="USD per self-hosted minute"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft.selfHostedFeePerMinuteUsd}
              disabled={readOnly || !data.writable}
              error={errors.selfHostedFeePerMinuteUsd}
              onChange={(e) => change('selfHostedFeePerMinuteUsd', e.target.value)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
      {saveError && <ErrorAlert title="Not saved" message={saveError} />}
      {notice && !dirty && <ResultChip tone="success">{notice}</ResultChip>}
      {!readOnly && data.writable && (
        <SettingsFormFooter
          dirty={dirty}
          saving={saving}
          onSave={() => void save()}
          onDiscard={() => {
            setEdits(null)
            setSaveError(null)
          }}
          blockedReason={hasErrors ? 'Fix the fields marked above first.' : null}
        />
      )}
    </div>
  )
}
