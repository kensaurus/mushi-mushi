/**
 * FILE: apps/admin/src/components/FirstRunGate.tsx
 * PURPOSE: Open setup for an account with no app instead of an empty Bugs or
 *          Home page (lib/firstRun.ts has the rule). Renders the page while the
 *          app and team lists load, and whenever either read fails.
 */

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageData } from '../lib/usePageData'
import { shouldOpenSetup } from '../lib/firstRun'

export function FirstRunGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const setup = useSetupStatus()
  // Same query and cache key as the header's team switcher.
  const teams = usePageData<{ organizations: unknown[] }>('/v1/org', { scope: 'none' })
  const projectCount = setup.data && !setup.error ? setup.data.projects.length : null
  const teamCount = teams.data && !teams.error ? teams.data.organizations.length : null
  if (shouldOpenSetup({ pathname, projectCount, teamCount })) {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}
