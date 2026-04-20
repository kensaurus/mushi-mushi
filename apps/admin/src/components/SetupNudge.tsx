/**
 * FILE: apps/admin/src/components/SetupNudge.tsx
 * PURPOSE: Contextual empty-state that points users back to whichever setup
 *          step is blocking them from seeing data on the current page.
 *
 *          Wraps `EmptyState` and reads `useSetupStatus()` so the CTA is always
 *          accurate. When the relevant step is complete, falls back to a
 *          generic "no data yet" message + optional `fallback` action.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EmptyState, Btn } from './ui'
import { useSetupStatus, type SetupStepId } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'

interface SetupNudgeProps {
  /** What blocks this page when missing. Order matters — first incomplete wins. */
  requires: SetupStepId[]
  /** Title shown in the "everything is set up but no data yet" path. */
  emptyTitle: string
  /** Description shown in the "no data yet" path. */
  emptyDescription?: string
  /** Action shown in the "no data yet" path (e.g. a Refresh button). */
  emptyAction?: ReactNode
}

export function SetupNudge({
  requires,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: SetupNudgeProps) {
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)

  if (setup.loading) return null

  if (!setup.hasAnyProject) {
    return (
      <EmptyState
        title="Create your first project to get started"
        description="A project groups all bug reports from one application."
        action={
          <Link to="/onboarding" className="inline-block">
            <Btn size="sm">Open setup wizard</Btn>
          </Link>
        }
      />
    )
  }

  // Find the first incomplete step in the user's requested order so the CTA
  // matches the most natural next action (e.g. "no key" before "no SDK").
  for (const id of requires) {
    const step = setup.getStep(id)
    if (!step || step.complete) continue
    return (
      <EmptyState
        title={step.label}
        description={step.description}
        action={
          <Link to={step.cta_to} className="inline-block">
            <Btn size="sm">{step.cta_label}</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <EmptyState
      title={emptyTitle}
      description={emptyDescription}
      action={emptyAction}
    />
  )
}
