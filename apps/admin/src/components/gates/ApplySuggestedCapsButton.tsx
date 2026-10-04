/**
 * FILE: apps/admin/src/components/gates/ApplySuggestedCapsButton.tsx
 * PURPOSE: One-click fix for a `spend_cap_unset` finding (Plan 020 §4.2 #10).
 *          The suggestion comes from the last daily setup check, so before
 *          anything is shown or sent the button reads the project's current
 *          settings (GET /v1/admin/settings, uncached) and drops every cap
 *          set since then: a cap someone set is never overwritten. It reads
 *          them again at confirm time, then sends only the caps still unset
 *          to PATCH /v1/admin/settings (the route Settings → General → Spend
 *          limits saves through; the server re-validates every value and
 *          needs a project admin). A failed read sends nothing.
 *
 *          The finding stays listed until the next daily setup check runs, so
 *          the button turns into an "Applied" or "Already set" note instead of
 *          disappearing.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../ConfirmDialog'
import { Btn } from '../ui'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeApiError } from '../../lib/humanizeApiError'
import { useActiveOrgRole } from '../../lib/useActiveOrgRole'
import { describeSpendCaps, planSpendCaps, type SpendCapPlan, type SpendCapValues } from '../../lib/gateFindings'

interface Props {
  projectId: string
  values: SpendCapValues
  onApplied?: () => void
}

type Phase = 'idle' | 'checking' | 'confirm' | 'saving' | 'applied' | 'already_set'

const SPEND_LIMITS_PATH = '/settings?tab=general#spend-limits'

function confirmBody(plan: SpendCapPlan): string {
  const kept = plan.alreadySet.length
    ? ` Already set since the check ran, left as they are: ${plan.alreadySet.join(', ')}.`
    : ''
  return `${describeSpendCaps(plan.toSet).join(' ')}${kept} Fixes you start yourself are never blocked by the auto-fix limits. You can change or clear any of these in Settings → General → Spend limits.`
}

export function ApplySuggestedCapsButton({ projectId, values, onApplied }: Props) {
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>('idle')
  const [plan, setPlan] = useState<SpendCapPlan | null>(null)
  // Spend caps are owner/admin-only on the server: members and viewers get
  // the next step instead of a button that ends in a 403.
  const { canManage } = useActiveOrgRole()

  /** The current caps, uncached; null (after an error toast) when they could not be read. */
  const readPlan = async (): Promise<SpendCapPlan | null> => {
    const res = await apiFetch<Record<string, unknown>>(`/v1/admin/settings?project_id=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
    if (!res.ok || !res.data) {
      const e = res.error
        ? describeApiError(res.error, 'Could not check the current spend caps')
        : { title: 'Could not check the current spend caps', hint: 'Nothing was changed. Try again in a moment.' }
      toast.error(e.title, e.hint)
      return null
    }
    return planSpendCaps(values, res.data)
  }

  if (phase === 'applied' || phase === 'already_set') {
    return (
      <span className="text-2xs text-ok" role="status">
        {phase === 'applied' ? 'Applied.' : 'These caps are already set.'} This check clears on its next daily run.{' '}
        <Link to={SPEND_LIMITS_PATH} className="text-brand hover:underline">Spend limits</Link>
      </span>
    )
  }

  if (!canManage) {
    return (
      <span className="text-2xs text-fg-muted">
        Only team owners and admins can set spend caps. Ask one of them to apply these.
      </span>
    )
  }

  const open = async () => {
    setPhase('checking')
    const next = await readPlan()
    if (!next) {
      setPhase('idle')
      return
    }
    setPlan(next)
    setPhase(Object.keys(next.toSet).length === 0 ? 'already_set' : 'confirm')
  }

  const apply = async () => {
    setPhase('saving')
    // Re-read at confirm time: the dialog may have stayed open while someone set a cap.
    const latest = await readPlan()
    if (!latest) {
      setPhase('confirm')
      return
    }
    if (Object.keys(latest.toSet).length === 0) {
      setPhase('already_set')
      return
    }
    const res = await apiFetchMutate(`/v1/admin/settings?project_id=${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(latest.toSet),
    })
    if (!res.ok) {
      setPhase('idle')
      if (res.error?.code === 'FORBIDDEN') {
        toast.error('Could not apply the suggested caps', 'Only team owners and admins can change spend caps. Ask one of them to apply these.')
      } else {
        const e = describeApiError(res.error, 'Could not apply the suggested caps')
        toast.error(e.title, e.hint)
      }
      return
    }
    setPhase('applied')
    const kept = latest.alreadySet.length ? ` Left as they were: ${latest.alreadySet.join(', ')}.` : ''
    toast.success('Suggested caps applied', `Change them any time in Settings → General → Spend limits.${kept}`)
    onApplied?.()
  }

  return (
    <>
      <Btn
        size="sm"
        variant="primary"
        onClick={() => void open()}
        loading={phase === 'checking'}
        title="Set the suggested spend caps that are still unset for this app"
      >
        Apply suggested caps
      </Btn>
      {(phase === 'confirm' || phase === 'saving') && plan && (
        <ConfirmDialog
          title="Apply the suggested spend caps?"
          body={confirmBody(plan)}
          confirmLabel="Apply caps"
          loading={phase === 'saving'}
          onCancel={() => setPhase('idle')}
          onConfirm={apply}
        />
      )}
    </>
  )
}
