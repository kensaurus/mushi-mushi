/**
 * FILE: apps/admin/src/lib/repoCleanup.ts
 * PURPOSE: Wire types and plain-words labels for the Repo → Clean up tab
 *          (ADR 0051). Data: GET /v1/admin/projects/:id/repo-cleanup.
 */

import type { BadgeTone } from '../components/ui'

interface CleanupBranch {
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

type CleanupActionName = 'delete_branches' | 'close_prs' | 'set_delete_branch_on_merge' | 'restore_branches'
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

interface RestorableItem {
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
  pending_approval: { label: 'Waiting for approval', tone: 'warn' },
  approved: { label: 'Approved, not run', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  executing: { label: 'Running', tone: 'info' },
  executed: { label: 'Done', tone: 'ok' },
  failed: { label: 'Did not run', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export const OUTCOME: Record<CleanupItemResult['outcome'], { label: string; tone: BadgeTone }> = {
  done: { label: 'Done', tone: 'ok' },
  refused: { label: 'Refused', tone: 'warn' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  not_run: { label: 'Not run', tone: 'neutral' },
}

export const WHY_LABEL: Record<CleanupPr['why'][number], string> = {
  superseded: 'Replaced by a newer fix',
  hold: 'The AI review said hold',
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

export interface CleanupBlocker {
  /** The server's message, said once for every repo it applies to. */
  message: string
  repos: string[]
  /** The fix is a stored GitHub token (offer "Add token"). */
  needsToken: boolean
}

/**
 * The repos' errors grouped by message, so "No GitHub token is stored..." is
 * said once at the top of the tab with its fix, not as an amber box inside each
 * repository card under the explainer (fresh-eyes 2026-11-18).
 */
export function cleanupBlockers(repos: ReadonlyArray<Pick<CleanupRepo, 'repo' | 'error'>>): CleanupBlocker[] {
  const byMessage = new Map<string, string[]>()
  for (const r of repos) {
    if (!r.error) continue
    byMessage.set(r.error, [...(byMessage.get(r.error) ?? []), r.repo])
  }
  return [...byMessage.entries()].map(([message, list]) => ({
    message,
    repos: list,
    needsToken: /\btoken\b/i.test(message),
  }))
}

/** Where the app's GitHub token is stored. */
export const GITHUB_TOKEN_SETTINGS_PATH = '/integrations/config#platform-card-github'
