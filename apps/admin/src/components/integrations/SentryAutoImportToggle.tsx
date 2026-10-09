/**
 * FILE: apps/admin/src/components/integrations/SentryAutoImportToggle.tsx
 * PURPOSE: "Import new Sentry issues automatically" on the Sentry card.
 *          A connected token alone brought nothing in: new issues reached
 *          Mushi only through an alert-rule webhook built by hand in Sentry,
 *          and four of five connected projects had none (2026-10-09). With
 *          this on, the 15-minute Sentry poll imports new unresolved issues
 *          (project_settings.sentry_auto_import).
 */

import { useState } from 'react'
import { apiFetchMutate } from '../../lib/supabase'
import { ErrorAlert, Toggle } from '../ui'
import { formatRelative } from '../ui/metrics'

interface Props {
  enabled: boolean
  lastRunAt: string | null
}

export function SentryAutoImportToggle({ enabled, lastRunAt }: Props) {
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (next: boolean) => {
    setSaving(true)
    setError(null)
    const res = await apiFetchMutate('/v1/admin/integrations/platform/sentry', {
      method: 'PUT',
      body: JSON.stringify({ sentry_auto_import: next }),
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'Could not save the setting.')
      return
    }
    setOn(next)
  }

  return (
    <div className="border-t border-edge-subtle px-3 py-2 space-y-1">
      <Toggle
        label="Import new Sentry issues automatically"
        checked={on}
        onChange={(next) => void save(next)}
        disabled={saving}
        helpId="integrations.sentry.auto_import"
      />
      <p className="text-2xs text-fg-faint leading-snug">
        {on
          ? `Every 15 minutes, new unresolved issues become reports, and a fixed report reopens if its issue fires again. No Sentry webhook needed.${
              lastRunAt ? ` Last checked ${formatRelative(lastRunAt)}.` : ' The first check runs within 15 minutes.'
            }`
          : 'Off: new issues arrive only through a Sentry alert webhook or the import below. Turn on to check every 15 minutes, no webhook needed. Each new issue is triaged like any report.'}
      </p>
      {error && <ErrorAlert title="Not saved" message={error} />}
    </div>
  )
}
