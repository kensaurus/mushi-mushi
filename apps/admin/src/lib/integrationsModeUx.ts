/**
 * FILE: apps/admin/src/lib/integrationsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Integrations page.
 */

import { useAdminMode } from './mode'
import type { IntegrationStats } from '../components/integrations/types'

export type IntegrationsTabId = 'platform' | 'routing' | 'repo'

export interface IntegrationsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideIntegrationsSnapshot: boolean
}

export function useIntegrationsUx(): IntegrationsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideIntegrationsSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches integration posture. */
export function resolveQuickIntegrationsTab(stats: IntegrationStats): IntegrationsTabId {
  if (
    stats.topPriority === 'platform_down' ||
    stats.topPriority === 'incomplete' ||
    stats.topPriority === 'empty'
  ) {
    return 'platform'
  }
  if (stats.topPriority === 'healthy' && stats.platformConnected === stats.platformTotal) {
    return 'repo'
  }
  return 'platform'
}
