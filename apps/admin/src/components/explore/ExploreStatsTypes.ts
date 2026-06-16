/**
 * FILE: apps/admin/src/components/explore/ExploreStatsTypes.ts
 * PURPOSE: Explore shell stats — banner + EXPLORE SNAPSHOT strip.
 */

export type ExploreTabId =
  | 'overview'
  | 'graph'
  | 'layers'
  | 'search'
  | 'index'
  | 'ask'
  | 'tour'
  | 'domains'
  | 'knowledge'

export type ExploreLayerKey = 'ui' | 'lib' | 'backend' | 'test' | 'config' | 'other'

export type ExploreTopPriority =
  | 'no_project'
  | 'not_enabled'
  | 'indexing'
  | 'error'
  | 'empty'
  | 'ready'
  | 'stale'

export interface ExploreStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  codebaseIndexEnabled: boolean
  indexingEnabled: boolean | null
  repoUrl: string | null
  hasWebhookSecret: boolean
  indexedFiles: number
  symbolCount: number
  withEmbeddings: number
  layers: Record<ExploreLayerKey, number>
  topLanguages: string[]
  lastIndexedAt: string | null
  lastIndexAttemptAt: string | null
  lastIndexError: string | null
  topPriority: ExploreTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_EXPLORE_STATS: ExploreStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  codebaseIndexEnabled: false,
  indexingEnabled: null,
  repoUrl: null,
  hasWebhookSecret: false,
  indexedFiles: 0,
  symbolCount: 0,
  withEmbeddings: 0,
  layers: { ui: 0, lib: 0, backend: 0, test: 0, config: 0, other: 0 },
  topLanguages: [],
  lastIndexedAt: null,
  lastIndexAttemptAt: null,
  lastIndexError: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
