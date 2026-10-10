/**
 * FILE: apps/admin/src/components/settings/KnownIssuesSearchCard.tsx
 * PURPOSE: Settings → Web tools → "Search the web for known fixes". The
 *          per-project opt-in for "Others who hit this" on error reports
 *          (_shared/known-issues.ts): after classification, the report's
 *          error message, with IDs, URLs and long numbers removed, goes to
 *          Firecrawl to search GitHub and Stack Overflow. Off by default,
 *          because Firecrawl is a third party.
 *
 *          Reads and writes `known_issues_search_enabled` through
 *          GET / PATCH /v1/admin/settings (project admins only on write).
 *          It sits outside FirecrawlPanel's BYOK lock: Mushi's shared
 *          Firecrawl key powers it too.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ErrorAlert, Toggle } from '../ui'
import { IconLink } from '../icons'
import { SettingsList, SettingsRow } from './SettingsRow'

interface KnownIssuesSettings {
  known_issues_search_enabled?: boolean
}

export function KnownIssuesSearchCard({ projectId, id }: { projectId: string | null; id?: string }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  // False when the server has no such column yet (migration not applied).
  const [available, setAvailable] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await apiFetch<KnownIssuesSettings>('/v1/admin/settings')
    if (!res.ok) {
      setLoadError(res.error?.message ?? 'Could not load the known-fix search setting')
      return
    }
    const value = res.data?.known_issues_search_enabled
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
      body: JSON.stringify({ known_issues_search_enabled: next }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error('Could not change the known-fix search', res.error?.message)
      return
    }
    setEnabled(next)
    toast.success(next ? 'Known-fix search is on' : 'Known-fix search is off')
  }

  return (
    <SettingsList id={id} title="Known fixes on the web">
      <SettingsRow
        icon={<IconLink size={16} />}
        title="Search the web for known fixes"
        purpose={
          <>
            Off by default. When on, Mushi sends the error message from each error report to Firecrawl, with IDs,
            URLs and long numbers removed, to search GitHub and Stack Overflow (issues, merged fixes, docs) for
            known fixes, after classification and when someone presses Search again. The top results appear on the
            report under &ldquo;Others who hit this&rdquo;. A fix dispatch with little code context also sends the
            report summary (or the start of its description) to find related fixes.
          </>
        }
        action={
          <Toggle
            ariaLabel="Search the web for known fixes"
            checked={enabled === true}
            disabled={enabled === null || saving || !available}
            onChange={(next) => void change(next)}
          />
        }
      >
        {!available && enabled !== null ? (
          <p className="text-2xs text-fg-faint">This setting becomes available after the next server update.</p>
        ) : null}
        {loadError ? <ErrorAlert title="Known-fix search" message={loadError} onRetry={() => void load()} /> : null}
      </SettingsRow>
    </SettingsList>
  )
}
