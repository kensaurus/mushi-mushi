/**
 * Lightweight content-quality slice for sidebar nav badges.
 */

type ContentQualityTopPriority =
  | 'no_project'
  | 'regen_failed'
  | 'user_flags'
  | 'open_issues'
  | 'regenerating'
  | 'healthy'

export interface ContentQualityStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  openCount: number
  inReviewCount: number
  regeneratingCount: number
  userFlagOpenCount: number
  failedRegenCount: number
  needsAttentionCount: number
  /** Newest issue write. Null when this project has no content-check rows. */
  latestAt?: string | null
  topPriority: ContentQualityTopPriority
}

export const EMPTY_CONTENT_QUALITY_STATS: ContentQualityStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  openCount: 0,
  inReviewCount: 0,
  regeneratingCount: 0,
  userFlagOpenCount: 0,
  failedRegenCount: 0,
  needsAttentionCount: 0,
  topPriority: 'no_project',
}
