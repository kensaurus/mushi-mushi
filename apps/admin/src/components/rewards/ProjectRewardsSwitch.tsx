/**
 * FILE: apps/admin/src/components/rewards/ProjectRewardsSwitch.tsx
 * PURPOSE: Turn rewards on or off for the active project
 *          (project_settings.rewards_enabled via PUT /v1/admin/rewards/project-status).
 *
 *   Until this existed the column had no writer: the status banner said
 *   "Rewards disabled" forever and pointed at a Settings tab with no toggle.
 */

import { useCallback, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { plainApiError } from '../../lib/humanizeApiError'
import { Btn, Card } from '../ui'

/** PUT the project's rewards flag; resolves to an error sentence or null. */
async function setProjectRewardsEnabled(projectId: string, enabled: boolean): Promise<string | null> {
  const res = await apiFetch('/v1/admin/rewards/project-status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, enabled }),
  })
  return res.ok ? null : plainApiError(res.error, 'Could not change rewards for this project. Try again.')
}

/** Shared toggle state for the banner button and the Settings switch. */
export function useProjectRewardsToggle(onChanged: () => void) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const toggle = useCallback(
    async (projectId: string, projectName: string | null, enabled: boolean) => {
      setBusy(true)
      try {
        const error = await setProjectRewardsEnabled(projectId, enabled)
        if (error) {
          toast.error(error)
          return
        }
        const name = projectName ?? 'this project'
        toast.success(
          enabled
            ? `Rewards are on for ${name}. App activity now earns points.`
            : `Rewards are off for ${name}. App activity stops earning points.`,
        )
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [onChanged, toast],
  )
  return { busy, toggle }
}

export function ProjectRewardsSwitch({
  projectId,
  projectName,
  enabled,
  canEdit,
  onChanged,
}: {
  projectId: string | null
  projectName: string | null
  enabled: boolean
  canEdit: boolean
  onChanged: () => void
}) {
  const { busy, toggle } = useProjectRewardsToggle(onChanged)
  if (!projectId) return null
  const name = projectName ?? 'this project'
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3" data-testid="project-rewards-switch">
      <div className="min-w-0">
        <p className="text-xs font-medium text-fg">
          Rewards for {name}: {enabled ? 'on' : 'off'}
        </p>
        <p className="text-2xs text-fg-muted">
          {enabled
            ? 'Activity your app sends through the SDK earns points under the rules below.'
            : 'Activity your app sends is accepted but earns no points until you turn rewards on.'}
        </p>
      </div>
      {canEdit ? (
        <Btn
          size="sm"
          variant={enabled ? 'ghost' : 'primary'}
          loading={busy}
          onClick={() => void toggle(projectId, projectName, !enabled)}
        >
          {enabled ? 'Turn off' : 'Turn on rewards'}
        </Btn>
      ) : (
        <span className="text-2xs text-fg-faint">Upgrade to Starter or higher to change this.</span>
      )}
    </Card>
  )
}
