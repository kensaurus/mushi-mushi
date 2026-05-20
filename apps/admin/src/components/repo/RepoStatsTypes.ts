/**
 * FILE: apps/admin/src/components/repo/RepoStatsTypes.ts
 * PURPOSE: Repo shell stats — banner + REPO SNAPSHOT strip.
 */

export type RepoTabId = 'overview' | 'branches' | 'activity'

export type RepoTopPriority =
  | 'no_project'
  | 'no_repo'
  | 'no_github_app'
  | 'ci_failing'
  | 'stuck'
  | 'waiting'
  | 'healthy'

export interface RepoStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  hasRepo: boolean
  repoUrl: string | null
  defaultBranch: string | null
  hasGithubApp: boolean
  indexingEnabled: boolean
  lastIndexedAt: string | null
  indexedFiles: number
  totalBranches: number
  prOpen: number
  ciPassing: number
  ciFailed: number
  merged: number
  failedToOpen: number
  topPriority: RepoTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_REPO_STATS: RepoStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  hasRepo: false,
  repoUrl: null,
  defaultBranch: null,
  hasGithubApp: false,
  indexingEnabled: false,
  lastIndexedAt: null,
  indexedFiles: 0,
  totalBranches: 0,
  prOpen: 0,
  ciPassing: 0,
  ciFailed: 0,
  merged: 0,
  failedToOpen: 0,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
