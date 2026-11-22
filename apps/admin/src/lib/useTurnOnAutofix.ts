/**
 * FILE: apps/admin/src/lib/useTurnOnAutofix.ts
 * PURPOSE: Turn on Autofix for an app where the person is, with feedback,
 *          instead of sending them to Integrations to find the toggle
 *          (owner, 2026-11-17: the report page's "Turn on" only navigated).
 *          Used by the report page's dispatch steps and the setup
 *          checklist's "Task filed" line.
 *
 *          The server allows only a project owner or admin
 *          (POST /v1/admin/projects/:id/autofix/toggle, FORBIDDEN otherwise).
 */

import { useCallback, useState } from 'react'
import { apiFetch } from './supabase'
import { useToast } from './toast'

export function useTurnOnAutofix(projectId: string | null | undefined, onDone?: () => void) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  const turnOn = useCallback(async (): Promise<boolean> => {
    if (!projectId || saving) return false
    setSaving(true)
    const res = await apiFetch<{ autofix_enabled: boolean }>(`/v1/admin/projects/${projectId}/autofix/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(
        'Autofix is still off',
        res.error?.code === 'FORBIDDEN'
          ? 'Only a project owner or admin can turn it on. Ask one of them.'
          : (res.error?.message ?? 'Mushi Mushi could not turn it on. Try again in a minute.'),
      )
      return false
    }
    toast.success('Autofix is on', 'Mushi Mushi can now start a fix for this app and open it as a draft pull request.')
    onDone?.()
    return true
  }, [projectId, saving, toast, onDone])

  return { turnOn, saving }
}
