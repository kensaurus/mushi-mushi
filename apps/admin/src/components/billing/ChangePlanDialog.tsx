/**
 * FILE: apps/admin/src/components/billing/ChangePlanDialog.tsx
 * PURPOSE: Confirm an in-app plan change for a project that already pays
 *          (Indie ↔ Pro, monthly ↔ annual). Shows Stripe's prorated preview
 *          before anything changes, then applies it.
 *
 * Server: POST /v1/admin/billing/change-plan/preview and /change-plan
 * (packages/server/supabase/functions/api/routes/billing-change-plan.ts).
 * The Stripe customer portal cannot switch a subscription that has a metered
 * item, so this dialog is the only switch path.
 */

import { useCallback, useEffect, useState } from 'react'
import { Btn } from '../ui'
import { Modal } from '../Modal'
import { ContainedBlock, InlineProof } from '../report-detail/ReportSurface'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeBillingError } from '../../lib/billingErrors'
import { formatBillingMoney } from './billing-tokens'

type BillingInterval = 'monthly' | 'annual'

export interface ChangePlanTarget {
  projectId: string
  planId: string
  planName: string
  billingInterval: BillingInterval
}

interface PlanChangePreview {
  /** Unix seconds when Stripe would bill this; later than now during a trial. */
  invoice_at: number | null
  amount_due: number
  total: number
  currency: string
  resets_billing_date: boolean
  overage_billed: boolean
  lines: Array<{ description: string | null; amount: number }>
}

export interface ChangePlanDialogProps {
  target: ChangePlanTarget | null
  onClose: () => void
  onChanged: () => void
}

export function ChangePlanDialog({ target, onClose, onChanged }: ChangePlanDialogProps) {
  const toast = useToast()
  const [preview, setPreview] = useState<PlanChangePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const body = target
    ? JSON.stringify({
        project_id: target.projectId,
        plan_id: target.planId,
        billing_interval: target.billingInterval,
      })
    : null

  useEffect(() => {
    setPreview(null)
    setPreviewError(null)
    if (!body) return
    let cancelled = false
    void apiFetch<PlanChangePreview>('/v1/admin/billing/change-plan/preview', { method: 'POST', body }).then(
      (res) => {
        if (cancelled) return
        if (!res.ok || !res.data) setPreviewError(describeBillingError(res.error))
        else setPreview(res.data)
      },
    )
    return () => {
      cancelled = true
    }
  }, [body])

  const confirm = useCallback(async () => {
    if (!body || !target) return
    setApplying(true)
    const res = await apiFetch<{ plan_id: string }>('/v1/admin/billing/change-plan', { method: 'POST', body })
    setApplying(false)
    if (!res.ok) {
      toast.error('Plan did not change', describeBillingError(res.error))
      return
    }
    toast.success(
      'Plan changed',
      `${target.planName} ${target.billingInterval}. Billing updates within a minute.`,
    )
    onClose()
    onChanged()
  }, [body, target, toast, onClose, onChanged])

  if (!target) return null
  const intervalLabel = target.billingInterval === 'annual' ? 'annual' : 'monthly'

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Switch to ${target.planName} (${intervalLabel})`}
      footer={
        <>
          <Btn size="sm" variant="cancel" onClick={onClose} disabled={applying}>
            Keep current plan
          </Btn>
          <Btn
            size="sm"
            onClick={() => void confirm()}
            disabled={!preview || applying}
            loading={applying}
            data-testid="change-plan-confirm"
          >
            Confirm change
          </Btn>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {previewError ? (
          <p className="text-danger" role="alert">{previewError}</p>
        ) : !preview ? (
          <p className="text-fg-muted">Asking Stripe for the prorated amount…</p>
        ) : (
          <>
            <ContainedBlock tone="neutral" className="space-y-1">
              <InlineProof className="border-0 bg-transparent px-0 py-0">
                {preview.invoice_at != null && preview.invoice_at * 1000 > Date.now() + 3_600_000 ? (
                  <>
                    Nothing is charged now. Next invoice on{' '}
                    {new Date(preview.invoice_at * 1000).toLocaleDateString()}:{' '}
                    <strong>{formatBillingMoney(Math.max(0, preview.amount_due), preview.currency)}</strong>
                  </>
                ) : preview.amount_due > 0 ? (
                  <>Charged now: <strong>{formatBillingMoney(preview.amount_due, preview.currency)}</strong></>
                ) : preview.total < 0 ? (
                  <>
                    Credit to your account:{' '}
                    <strong>{formatBillingMoney(-preview.total, preview.currency)}</strong>, used on your next
                    invoices
                  </>
                ) : (
                  <>Nothing is charged now.</>
                )}
              </InlineProof>
              <p className="text-2xs text-fg-muted">
                Unused time on the current plan is credited and the new plan is prorated.
                {preview.resets_billing_date ? ' Your billing date moves to today.' : ''}
              </p>
            </ContainedBlock>
            <p className="text-2xs text-fg-muted">
              {preview.overage_billed
                ? 'Diagnoses above the included amount are billed monthly at the plan’s overage rate, up to your spend cap.'
                : 'Annual plans include a fixed number of diagnoses each month. When they run out, new diagnoses pause until the next month. Switch to monthly or Pro for more.'}
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
