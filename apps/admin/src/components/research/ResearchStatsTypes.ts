/**
 * FILE: apps/admin/src/components/research/ResearchStatsTypes.ts
 * PURPOSE: Research shell stats — banner + RESEARCH SNAPSHOT strip.
 */

export type ResearchTabId = 'overview' | 'search' | 'history'

export type ResearchTopPriority =
  | 'no_project'
  | 'firecrawl_not_configured'
  | 'firecrawl_auth_failed'
  | 'firecrawl_error'
  | 'firecrawl_untested'
  | 'ready_no_sessions'
  | 'unattached_snippets'
  | 'healthy'

export interface ResearchStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  sessions: number
  snippets: number
  attached: number
  unattachedSnippets: number
  lastSessionAt: string | null
  daysSinceLastSearch: number | null
  firecrawlConfigured: boolean
  firecrawlReady: boolean
  firecrawlTestStatus: string | null
  firecrawlKeyHint: string | null
  allowedDomainsCount: number
  maxPagesPerCall: number
  topPriority: ResearchTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_RESEARCH_STATS: ResearchStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  sessions: 0,
  snippets: 0,
  attached: 0,
  unattachedSnippets: 0,
  lastSessionAt: null,
  daysSinceLastSearch: null,
  firecrawlConfigured: false,
  firecrawlReady: false,
  firecrawlTestStatus: null,
  firecrawlKeyHint: null,
  allowedDomainsCount: 0,
  maxPagesPerCall: 5,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
