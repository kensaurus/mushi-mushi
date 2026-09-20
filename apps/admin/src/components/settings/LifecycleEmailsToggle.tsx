/**
 * FILE: apps/admin/src/components/settings/LifecycleEmailsToggle.tsx
 * PURPOSE: Account-level "Onboarding emails" switch (day-0 welcome, day-2
 *          nudge, day-7 check-in — docs/plan-gtm.md Workstream B §3).
 *
 *          Reads/writes `GET/PUT /v1/admin/me/lifecycle-emails { enabled }`.
 *          Account-scoped, so it saves on toggle instead of riding the
 *          project settings form's Save button, and sends no tenant headers.
 *          The unsubscribe link in each email flips the same flag.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Section, Toggle } from '../ui'
import { ContainedBlock } from '../report-detail/ReportSurface'

interface LifecycleEmailsState {
  enabled: boolean
}

const PATH = '/v1/admin/me/lifecycle-emails'

export function LifecycleEmailsToggle() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<LifecycleEmailsState>(PATH, { scope: 'none' })
  const [pending, setPending] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const enabled = pending ?? data?.enabled ?? true

  async function setEnabled(next: boolean) {
    setPending(next)
    setSaving(true)
    const res = await apiFetch<LifecycleEmailsState>(PATH, {
      method: 'PUT',
      body: JSON.stringify({ enabled: next }),
      scope: 'none',
      idempotencyKey: crypto.randomUUID(),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(next ? 'Onboarding emails on' : 'Onboarding emails off')
      setPending(null)
      reload()
    } else {
      setPending(null)
      toast.error('Could not update onboarding emails', res.error?.message)
    }
  }

  return (
    <Section title="Your account">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-fg">Onboarding emails</p>
          <ContainedBlock tone="muted" className="mt-1">
            <p className="text-2xs leading-relaxed text-fg-muted">
              A short series while you set up: a welcome with your snippet, a nudge if no report has landed
              after two days, and a one-question check-in after a week. Account-service mail only — no
              marketing list, no tracking pixels. Saves immediately.
            </p>
          </ContainedBlock>
          {error && (
            <p className="mt-1 text-2xs text-danger">
              Could not load this setting ({error}).{' '}
              <button type="button" onClick={reload} className="underline underline-offset-2 hover:text-fg">
                Retry
              </button>
            </p>
          )}
        </div>
        <Toggle
          ariaLabel="Onboarding emails"
          label={enabled ? 'On' : 'Off'}
          checked={enabled}
          disabled={loading || saving || Boolean(error)}
          onChange={(next) => void setEnabled(next)}
        />
      </div>
    </Section>
  )
}
