/**
 * FILE: apps/admin/src/lib/repoCleanup.ts
 * PURPOSE: Wire types and plain-words labels for the Repo → Clean up tab
 *          (ADR 0051). Data: GET /v1/admin/projects/:id/repo-cleanup.
 */

import type { BadgeTone } from '../components/ui'

export interface CleanupBranch {
  key: string
  branch: string
  headSha: string
  prNumber: number
  prState: 'merged' | 'closed'
  closedAt: string | null
  reason: string
}

export interface CleanupPr {
  key: string
  prNumber: number
  headSha: string
  branch: string
  fixAttemptId: string
  reportId: string | null
  why: Array<'superseded' | 'hold' | 'stale'>
  reason: string
  draft: boolean
}

export interface CleanupRepo {
  repo: string
  error: string | null
  defaultBranch: string | null
  deleteBranchOnMerge: boolean | null
  canChangeSetting: boolean
  settingPending: boolean
  branches: CleanupBranch[]
  prs: CleanupPr[]
  kept: Array<{ key: string; reason: string }>
  keptCount: number
  gone: number
  truncated: boolean
}

export type CleanupActionName = 'delete_branches' | 'close_prs' | 'set_delete_branch_on_merge' | 'restore_branches'
export type CleanupStatus = 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'expired'

export interface CleanupItemResult {
  key: string
  outcome: 'done' | 'refused' | 'skipped' | 'failed' | 'not_run'
  detail: string
  branch?: string
  prNumber?: number
}

export interface CleanupAction {
  id: string
  action: CleanupActionName
  repo: string | null
  itemCount: number
  payload: { items?: Array<{ key: string; branch?: string; prNumber?: number; headSha?: string; sha?: string; reason?: string }> }
  payloadSha256: string
  reason: string | null
  status: CleanupStatus
  requestedBy: string
  requestedAt: string
  expiresAt: string | null
  executedAt: string | null
  result: { items?: CleanupItemResult[]; detail?: string } | null
  error: string | null
}

export interface RestorableItem {
  id: string
  repo: string
  branch: string
  deleted_sha: string
  created_at: string
}

export interface CleanupView {
  projectId: string
  staleDays: number
  repos: CleanupRepo[]
  actions: CleanupAction[]
  restorable: RestorableItem[]
  migrationPending: boolean
  canDecide: boolean
  canRequest: boolean
  limits: { maxItems: number; perHour: number; approvalMinutes: number }
  raceNote: string
}

export const CLEANUP_STATUS: Record<CleanupStatus, { label: string; tone: BadgeTone }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'warnSubtle' },
  approved: { label: 'Approved, not run', tone: 'infoSubtle' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  executing: { label: 'Running', tone: 'infoSubtle' },
  executed: { label: 'Done', tone: 'okSubtle' },
  failed: { label: 'Did not run', tone: 'dangerSubtle' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export const OUTCOME: Record<CleanupItemResult['outcome'], { label: string; tone: BadgeTone }> = {
  done: { label: 'Done', tone: 'okSubtle' },
  refused: { label: 'Refused', tone: 'warnSubtle' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'dangerSubtle' },
  not_run: { label: 'Not run', tone: 'neutral' },
}

export const WHY_LABEL: Record<CleanupPr['why'][number], string> = {
  superseded: 'Replaced by a newer fix',
  hold: 'Opus said hold',
  stale: 'No new commits',
}

export function actionTitle(a: Pick<CleanupAction, 'action' | 'itemCount' | 'repo'>): string {
  const n = a.itemCount
  const s = n === 1 ? '' : 'es'
  switch (a.action) {
    case 'delete_branches':
      return `Delete ${n} branch${s} in ${a.repo ?? 'the repo'}`
    case 'close_prs':
      return `Close ${n} pull request${n === 1 ? '' : 's'} in ${a.repo ?? 'the repo'}`
    case 'restore_branches':
      return `Restore ${n} branch${s} in ${a.repo ?? 'the repo'}`
    default:
      return `Turn on automatic branch deletion in ${a.repo ?? 'the repo'}`
  }
}

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '')
