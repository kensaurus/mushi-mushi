/**
 * FILE: apps/admin/src/components/billing/BillingPredictabilityControls.tsx
 * PURPOSE: Inline controls for spend cap override and usage-alert email on the
 *   Billing page — implements the predictability tools from Phase 2 billing.
 *
 * OVERVIEW:
 * - Spend cap: PUT /v1/admin/billing/spend-cap
 * - Alert email: PUT /v1/admin/billing/alert-email
 *
 * USAGE:
 *   <BillingPredictabilityControls projectId={...} spendCapUsd={...} alertEmail={...} onSaved={reload} />
 */

import { useCallback, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Input } from '../ui'
import { ContainedBlock, InlineProof } from '../report-detail/ReportSurface'
import { ConfigHelp } from '../ConfigHelp'

interface Props {
  projectId: string
  isSubscribed: boolean
  spendCapUsd: number | null
  planDefaultCapUsd: number | null
  alertEmail: string | null
  disabled?: boolean
  onSaved?: () => void
}

export function BillingPredictabilityControls({
  projectId,
  isSubscribed,
  spendCapUsd,
  planDefaultCapUsd,
  alertEmail,
  disabled = false,
  onSaved,
}: Props) {
  const toast = useToast()
  const [capInput, setCapInput] = useState(
    spendCapUsd != null ? String(spendCapUsd) : '',
  )
  const [emailInput, setEmailInput] = useState(alertEmail ?? '')
  const [savingCap, setSavingCap] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)

  const saveCap = useCallback(async () => {
    setSavingCap(true)
    const trimmed = capInput.trim()
    const capRaw =
      trimmed === '' ? null : Number(trimmed)
    if (capRaw !== null && (Number.isNaN(capRaw) || capRaw < 0 || capRaw > 100_000)) {
      toast.error('Invalid cap', 'Enter 0–100000 or leave blank to use plan default.')
      setSavingCap(false)
      return
    }
    const res = await apiFetch<{ spend_cap_usd: number | null }>(
      '/v1/admin/billing/spend-cap',
      {
        method: 'PUT',
        body: JSON.stringify({ project_id: projectId, spend_cap_usd: capRaw }),
      },
    )
    setSavingCap(false)
    if (!res.ok) {
      toast.error('Could not save cap', res.error?.message ?? 'Try again.')
      return
    }
    toast.success('Spend cap updated', capRaw == null ? 'Using plan default.' : `$${capRaw}/mo cap saved.`)
    onSaved?.()
  }, [capInput, projectId, toast, onSaved])

  const saveEmail = useCallback(async () => {
    setSavingEmail(true)
    const trimmed = emailInput.trim()
    const res = await apiFetch<{ alert_email: string | null }>(
      '/v1/admin/billing/alert-email',
      {
        method: 'PUT',
        body: JSON.stringify({
          project_id: projectId,
          alert_email: trimmed === '' ? null : trimmed,
        }),
      },
    )
    setSavingEmail(false)
    if (!res.ok) {
      toast.error('Could not save alert email', res.error?.message ?? 'Try again.')
      return
    }
    toast.success('Alert email updated', trimmed ? `Alerts go to ${trimmed}.` : 'Using project owner email.')
    onSaved?.()
  }, [emailInput, projectId, toast, onSaved])

  return (
    <ContainedBlock tone="muted" className="p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          Predictability controls
        </span>
        <ConfigHelp helpId="billing.spend_cap" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Input
            label="Monthly spend cap (USD)"
            helpId="billing.spend_cap"
            type="number"
            min={0}
            max={100000}
            step={1}
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            placeholder={planDefaultCapUsd != null ? String(planDefaultCapUsd) : 'Plan default'}
            disabled={disabled || savingCap || !isSubscribed}
          />
          <InlineProof className="border-0 bg-transparent px-0 py-0 text-fg-muted">
            {!isSubscribed
              ? 'Upgrade to a paid plan to set a custom spend cap.'
              : planDefaultCapUsd != null
              ? `Plan default: $${planDefaultCapUsd}/mo. Leave blank to reset.`
              : 'Hard stop tier — no overage cap applies.'}
          </InlineProof>
          <Btn size="sm" onClick={saveCap} loading={savingCap} disabled={disabled || !isSubscribed}>
            Save cap
          </Btn>
        </div>

        <div className="space-y-1.5">
          <Input
            label="Usage alert email"
            helpId="billing.alert_email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="owner@yourcompany.com"
            disabled={disabled || savingEmail}
          />
          <InlineProof className="border-0 bg-transparent px-0 py-0 text-fg-muted">
            50%, 80%, and 100% diagnosis quota alerts. Blank = project owner.
          </InlineProof>
          <Btn size="sm" onClick={saveEmail} loading={savingEmail} disabled={disabled}>
            Save alert email
          </Btn>
        </div>
      </div>
    </ContainedBlock>
  )
}
