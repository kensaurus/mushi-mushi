/**
 * FILE: apps/admin/src/components/releases/ReleasesStatsTypes.ts
 * PURPOSE: Releases shell stats — banner + RELEASES SNAPSHOT strip.
 */

export type ReleasesTabId = 'overview' | 'drafts' | 'published' | 'draft'

export type ReleasesTopPriority =
  | 'no_project'
  | 'drafts_pending'
  | 'ready_to_draft'
  | 'no_fixes'
  | 'no_releases'
  | 'healthy'

export interface ReleasesStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  draftCount: number
  publishedCount: number
  totalReleases: number
  totalFixesLinked: number
  totalContributors: number
  totalCredits: number
  creditsNotified: number
  creditsPending: number
  fulfilledTicketsShipped: number
  fixedReportsCount: number
  openFeedbackTickets: number
  lastPublishedAt: string | null
  lastDraftAt: string | null
  topPriority: ReleasesTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_RELEASES_STATS: ReleasesStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  draftCount: 0,
  publishedCount: 0,
  totalReleases: 0,
  totalFixesLinked: 0,
  totalContributors: 0,
  totalCredits: 0,
  creditsNotified: 0,
  creditsPending: 0,
  fulfilledTicketsShipped: 0,
  fixedReportsCount: 0,
  openFeedbackTickets: 0,
  lastPublishedAt: null,
  lastDraftAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
