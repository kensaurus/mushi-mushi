/**
 * FILE: apps/admin/src/components/notifications/ReporterNotificationsToggle.tsx
 * PURPOSE: The one switch for `reporter_notifications_enabled` (suspected-bugs
 *          entry 118: every "turn it on" button pointed at Settings, which had
 *          no such control).
 *
 * The save is confirmed by reading the setting back: a server that ignores
 * the field (an older deploy drops unknown keys and still answers ok) must
 * not look like a success.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { ResultChip, Toggle } from '../ui'

interface Props {
  enabled: boolean
  /** Reload the page's stats after a change. */
  onChanged: () => void
}

type Outcome = { ok: boolean; text: string; at: string }

export function ReporterNotificationsToggle({ enabled, onChanged }: Props) {
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  async function setEnabled(next: boolean) {
    setSaving(true)
    setOutcome(null)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ reporter_notifications_enabled: next }),
    })
    if (!res.ok) {
      setSaving(false)
      setOutcome({ ok: false, text: res.error?.message ?? 'Not saved. Try again in a moment.', at: new Date().toISOString() })
      return
    }
    const check = await apiFetch<{ reporter_notifications_enabled?: boolean | null }>('/v1/admin/settings')
    setSaving(false)
    const stored = check.ok ? check.data?.reporter_notifications_enabled === true : null
    if (stored !== next) {
      setOutcome({
        ok: false,
        text: 'Not saved: the server did not keep the change. Try again later.',
        at: new Date().toISOString(),
      })
    } else {
      setOutcome({
        ok: true,
        text: next ? 'Reporters now get updates in the bug widget.' : 'Reporter updates are off.',
        at: new Date().toISOString(),
      })
    }
    onChanged()
  }

  return (
    <div className="space-y-2">
      <Toggle
        label={enabled ? 'Reporter updates are on' : 'Reporter updates are off'}
        checked={enabled}
        disabled={saving}
        onChange={(v) => void setEnabled(v)}
      />
      <p className="text-sm text-fg-secondary">
        When it is on, people who reported a bug see when it is triaged, fixed and shipped, in the bug widget.
      </p>
      {outcome && (
        <ResultChip tone={outcome.ok ? 'success' : 'error'} at={outcome.at}>
          {outcome.text}
        </ResultChip>
      )}
    </div>
  )
}
