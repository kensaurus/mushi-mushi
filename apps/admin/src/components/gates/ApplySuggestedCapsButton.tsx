/**
 * FILE: apps/admin/src/components/gates/ApplySuggestedCapsButton.tsx
 * PURPOSE: One-click fix for a `spend_cap_unset` finding (Plan 020 §4.2 #10).
 *          Shows exactly what will be set, asks to confirm, then sends the
 *          suggested caps to PATCH /v1/admin/settings for that project (the
 *          same route Settings → General → Spend limits saves through; the
 *          server re-validates every value and needs a project admin).
 *
 *          The finding stays listed until the next daily setup check runs, so
 *          the button turns into an "Applied" note instead of disappearing.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../ConfirmDialog'
import { Btn } from '../ui'
import { apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeSpendCaps, type SpendCapValues } from '../../lib/gateFindings'

interface Props {
  projectId: string
  values: SpendCapValues
  onApplied?: () => void
}

export function ApplySuggestedCapsButton({ projectId, values, onApplied }: Props) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applied, setApplied] = useState(false)

  if (applied) {
    return (
      <span className="text-2xs text-ok" role="status">
        Applied. This check clears on its next daily run.{' '}
        <Link to="/settings?tab=general#spend-limits" className="text-brand hover:underline">Spend limits</Link>
      </span>
    )
  }

  const apply = async () => {
    setSaving(true)
    const res = await apiFetchMutate(`/v1/admin/settings?project_id=${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    })
    setSaving(false)
    if (res.ok) {
      setConfirming(false)
      setApplied(true)
      toast.success('Suggested caps applied', 'Change them any time in Settings → General → Spend limits.')
      onApplied?.()
    } else {
      setConfirming(false)
      toast.error('Could not apply the suggested caps', res.error?.message)
    }
  }

  return (
    <>
      <Btn size="sm" variant="primary" onClick={() => setConfirming(true)} title="Set the suggested spend caps for this app">
        Apply suggested caps
      </Btn>
      {confirming && (
        <ConfirmDialog
          title="Apply the suggested spend caps?"
          body={`${describeSpendCaps(values).join(' ')} Caps that are already set are not changed. Fixes you start yourself are never blocked by the auto-fix limits. You can change or clear any of these in Settings → General → Spend limits.`}
          confirmLabel="Apply caps"
          loading={saving}
          onCancel={() => setConfirming(false)}
          onConfirm={apply}
        />
      )}
    </>
  )
}
