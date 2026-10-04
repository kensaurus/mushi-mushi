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
import { Toggle } from '../ui'
import { IconBell } from '../icons'
import { SettingsList, SettingsRow } from './SettingsRow'

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
    <SettingsList title="Your account" description="Settings for you, not just this project. They save straight away.">
      <SettingsRow
        icon={<IconBell size={16} />}
        title="Onboarding emails"
        purpose="A short series while you set up: a welcome with your snippet, a nudge if no report has arrived after two days, and a one-question check-in after a week. Account email only; no marketing list, no tracking pixels."
        status={
          error ? (
            <p className="text-sm text-danger">
              Couldn&apos;t load this setting.{' '}
              <button type="button" onClick={reload} className="underline underline-offset-2 hover:text-fg">
                Retry
              </button>
            </p>
          ) : undefined
        }
        action={
          <Toggle
            ariaLabel="Onboarding emails"
            label={enabled ? 'On' : 'Off'}
            checked={enabled}
            disabled={loading || saving || Boolean(error)}
            onChange={(next) => void setEnabled(next)}
          />
        }
      />
    </SettingsList>
  )
}
