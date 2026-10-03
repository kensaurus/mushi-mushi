/**
 * FILE: apps/admin/src/components/releases/AutoReleaseCard.tsx
 * PURPOSE: The per-project opt-in for auto-release. When the app ships (a
 *          GitHub release published, a successful production deploy, or a
 *          `release.published` event pushed to /v1/ingest/recipe/events),
 *          Mushi drafts a release from the fixed reports and publishes it,
 *          which tells each reporter their bug is live. Off by default.
 *
 *          Reads and writes `auto_release_enabled` through
 *          GET / PATCH /v1/admin/settings (project admins only on write).
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Card, ErrorAlert, Toggle } from '../ui'

interface AutoReleaseSettings {
  auto_release_enabled?: boolean
}

export function AutoReleaseCard({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  // False when the server has no such column yet (migration not applied).
  const [available, setAvailable] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await apiFetch<AutoReleaseSettings>('/v1/admin/settings')
    if (!res.ok) {
      setLoadError(res.error?.message ?? 'Could not load the auto-release setting')
      return
    }
    const value = res.data?.auto_release_enabled
    setAvailable(typeof value === 'boolean')
    setEnabled(value === true)
  }, [])

  useEffect(() => {
    void load()
  }, [load, projectId])

  async function change(next: boolean) {
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ auto_release_enabled: next }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error('Could not change auto-release', res.error?.message)
      return
    }
    setEnabled(next)
    toast.success(next ? 'Auto-release is on' : 'Auto-release is off')
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-fg">Release automatically when you ship</h3>
          <p className="text-2xs text-fg-secondary leading-snug">
            When a GitHub release is published, a production deploy succeeds, or your CI sends
            <code className="mx-1 font-mono">release.published</code>to
            <code className="mx-1 font-mono">/v1/ingest/recipe/events</code>, Mushi drafts a release from the reports
            fixed since the last one and publishes it. Each reporter hears their bug is live. Nothing happens when
            no report was fixed.
          </p>
          <p className="text-2xs text-fg-faint leading-snug">
            GitHub events need the Mushi GitHub App on the repo with the Releases and Deployments events.
          </p>
        </div>
        <Toggle
          ariaLabel="Auto-release"
          checked={enabled === true}
          disabled={enabled === null || saving || !available}
          onChange={(next) => void change(next)}
        />
      </div>
      {!available && enabled !== null ? (
        <p className="text-2xs text-fg-faint">Auto-release becomes available after the next server update.</p>
      ) : null}
      {loadError ? <ErrorAlert title="Auto-release" message={loadError} /> : null}
    </Card>
  )
}
