/**
 * FILE: apps/admin/src/components/DemoProjectHint.tsx
 * PURPOSE: One line under an empty page: when the active app has no reports
 *          yet and the team also has a demo app with data, offer to look at
 *          that instead of a blank list (console audit 2026-10-20, Phase 2;
 *          NN/g "empty states": never default to a totally empty screen).
 *          Rendered once by Layout, so no page has to remember it.
 */

import { Link, useLocation } from 'react-router-dom'
import { useActiveProjectId } from './ProjectSwitcher'
import { useSetupStatus, type SetupProject } from '../lib/useSetupStatus'

const DEMO_NAME_PATTERN = /demo/i

/** @internal exported for tests */
export function pickDemoProject(
  projects: readonly Pick<SetupProject, 'project_id' | 'project_name' | 'report_count'>[],
  activeProjectId: string | null,
): Pick<SetupProject, 'project_id' | 'project_name' | 'report_count'> | null {
  const active = projects.find((p) => p.project_id === activeProjectId) ?? null
  if (!active || active.report_count > 0) return null
  return projects.find((p) => p.project_id !== activeProjectId && DEMO_NAME_PATTERN.test(p.project_name) && p.report_count > 0) ?? null
}

export function DemoProjectHint() {
  const { pathname } = useLocation()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  if (!setup.resolved || !setup.data) return null
  const demo = pickDemoProject(setup.data.projects, activeProjectId)
  if (!demo) return null
  const params = new URLSearchParams({ project: demo.project_id })
  return (
    <p className="mt-4 text-xs text-fg-muted" data-testid="demo-project-hint">
      Nothing here yet because this app has no reports.{' '}
      <Link to={`${pathname}?${params.toString()}`} className="text-link underline hover:no-underline">
        See this page on {demo.project_name} →
      </Link>
    </p>
  )
}
