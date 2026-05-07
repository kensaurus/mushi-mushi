/**
 * FILE: apps/admin/src/lib/actionInboxFromDashboard.ts
 * PURPOSE: Builds the Action Inbox card model from `/v1/admin/dashboard`.
 * Shared by `/inbox` and `useNavCounts` so sidebar badge counts match the
 * page without duplicating derivation rules.
 */

import { computeNextBestAction } from './useNextBestAction'
import type { PageAction } from '../components/PageActionBar'
import type { DashboardData } from '../components/dashboard/types'

export type InboxCardGroup = 'plan' | 'do' | 'check' | 'act' | 'ops'

export interface InboxCard {
  id: string
  scope: string
  group: InboxCardGroup
  pageLabel: string
  pageTo: string
  action: PageAction | null
}

export function buildInboxCards(data: DashboardData | undefined): InboxCard[] {
  const reportsByDay = data?.reportsByDay ?? []
  const critical14d = reportsByDay.reduce((n, d) => n + (d.critical ?? 0), 0)
  const openBacklog = data?.counts?.openBacklog ?? 0
  const fixSummary = data?.fixSummary
  const failedFixes = fixSummary?.failed ?? 0
  const integrations = data?.integrations ?? []
  const redIntegrations = integrations.filter((i) => i.lastStatus === 'red' || i.lastStatus === 'fail').length
  const amberIntegrations = integrations.filter((i) => i.lastStatus === 'amber' || i.lastStatus === 'degraded').length

  return [
    {
      id: 'reports-plan',
      scope: 'intelligence',
      group: 'plan',
      pageLabel: 'Reports queue',
      pageTo: '/reports',
      action:
        critical14d > 0
          ? {
              tone: 'do',
              title: `${critical14d} critical report${critical14d === 1 ? '' : 's'} in the last 14 days`,
              reason: openBacklog > 0 ? `${openBacklog} still open.` : 'All resolved; double-check the rollup.',
              primary: { kind: 'link', to: '/reports?severity=critical', label: 'Open critical queue' },
            }
          : null,
    },
    {
      id: 'judge-check',
      scope: 'judge',
      group: 'check',
      pageLabel: 'Judge',
      pageTo: '/judge',
      action: computeNextBestAction({
        scope: 'judge',
        disagreementRate: null,
        sampledCount: 0,
        staleHoursAgo: 49,
      }),
    },
    {
      id: 'fixes-do',
      scope: 'fixes',
      group: 'do',
      pageLabel: 'Fixes in flight',
      pageTo: '/fixes',
      action:
        failedFixes > 0
          ? {
              tone: 'do',
              title: `${failedFixes} fix attempt${failedFixes === 1 ? '' : 's'} failed`,
              reason: 'Review the failure, fix the agent prompt, or retry manually.',
              primary: { kind: 'link', to: '/fixes?status=failed', label: 'Open failed fixes' },
            }
          : null,
    },
    {
      id: 'health-ops',
      scope: 'health',
      group: 'ops',
      pageLabel: 'Integration health',
      pageTo: '/health',
      action: computeNextBestAction({
        scope: 'health',
        redCount: redIntegrations,
        amberCount: amberIntegrations,
      }),
    },
    {
      id: 'integrations-act',
      scope: 'integrations',
      group: 'act',
      pageLabel: 'Integrations',
      pageTo: '/integrations',
      action: computeNextBestAction({
        scope: 'integrations',
        disconnectedCount: redIntegrations,
        expiringCount: 0,
      }),
    },
  ]
}

/** Count of inbox cards with a non-null next action — matches InboxPage "Open". */
export function inboxOpenActionCount(data: DashboardData | undefined): number {
  return buildInboxCards(data).filter((c) => c.action !== null).length
}
