/**
 * FILE: apps/admin/src/components/settings/AgentPrReviewCard.tsx
 * PURPOSE: Settings → General → "Review cloud agent pull requests" (ADR
 *          0030). On by default: Claude Opus 5.5 reviews every pull request a
 *          cloud coding agent opens as a fix, on the project's Anthropic key,
 *          and a "hold" verdict blocks merging from Mushi without an override.
 *
 *          Reads and writes `agent_pr_review_enabled` through
 *          GET / PATCH /v1/admin/settings (project admins only on write).
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ErrorAlert, Toggle } from '../ui'
import { IconShieldCheck } from '../icons'
import { ConfigHelp } from '../ConfigHelp'
import { SettingsList, SettingsRow } from './SettingsRow'

interface AgentPrReviewSettings {
  agent_pr_review_enabled?: boolean
}

export function AgentPrReviewCard({ projectId }: { projectId: string | null }) {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  // False when the server has no such column yet (migration not applied).
  const [available, setAvailable] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const res = await apiFetch<AgentPrReviewSettings>('/v1/admin/settings')
    if (!res.ok) {
      setLoadError(res.error?.message ?? 'Could not load the agent PR review setting')
      return
    }
    const value = res.data?.agent_pr_review_enabled
    setAvailable(typeof value === 'boolean')
    setEnabled(value !== false)
  }, [])

  useEffect(() => {
    void load()
  }, [load, projectId])

  async function change(next: boolean) {
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agent_pr_review_enabled: next }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error('Could not change the agent PR review', res.error?.message)
      return
    }
    setEnabled(next)
    toast.success(next ? 'Agent PR review is on' : 'Agent PR review is off')
  }

  return (
    <SettingsList title="Cloud agent pull requests">
      <SettingsRow
        icon={<IconShieldCheck size={16} />}
        title={
          <span className="inline-flex items-center gap-1">
            Review cloud agent pull requests
            <ConfigHelp helpId="settings.general.agent_pr_review" />
          </span>
        }
        purpose={
          <>
            Claude Opus 5.5 reads every pull request that Cursor or a GitHub cloud agent opens as a fix, with the bug
            report and CI, and answers merge, fix first or hold. A hold stops merging from Mushi until a member chooses
            to merge anyway, with a reason. It runs on your Anthropic key (usually $0.05 to $0.20 a review) and is
            skipped without one.
          </>
        }
        action={
          <Toggle
            ariaLabel="Review cloud agent pull requests"
            checked={enabled === true}
            disabled={enabled === null || saving || !available}
            onChange={(next) => void change(next)}
          />
        }
      >
        {!available && enabled !== null ? (
          <p className="text-2xs text-fg-faint">This setting becomes available after the next server update.</p>
        ) : null}
        {loadError ? <ErrorAlert title="Agent PR review" message={loadError} onRetry={() => void load()} /> : null}
      </SettingsRow>
    </SettingsList>
  )
}
