/**
 * FILE: reviewFollowups.ts
 * PURPOSE: Types and plain words for review follow-ups (ADR 0032): GET
 *          /v1/admin/byok/review-followups (settings, keys, scoreboard,
 *          latest follow-ups) and the `reviewFollowups` scoreboard on GET
 *          /v1/admin/byok/spend-down.
 */

/** Server `followupScoreboard` plus the period and how many apps it covers. */
export interface ReviewFollowupScoreboard {
  days: number
  dispatched: number
  inFlight: number
  finished: number
  completed: number
  failed: number
  pushed: number
  noChange: number
  verdictsAfter: { merge: number; fix_first: number; hold: number }
  awaitingReview: number
  conversionRate: number | null
  skipped: number
  /** Findings the safety screen kept out of prompts (URL, command, file outside the PR). */
  findingsDropped?: number
  since?: string
  apps?: number
}

export interface ReviewFollowupSettings {
  enabled: boolean
  enabledAt?: string | null
  /** Why Mushi turned them off on its own (the chosen key was deleted). */
  offReason?: string | null
  keyId: string | null
  model: string | null
  dailyLimit: number
}

export interface ReviewFollowupKey {
  id: string
  label: string | null
  keyHint: string | null
  /** 'universal': a key of an organization owner that serves every app they own (ADR 0031). */
  scope: 'organization' | 'project' | 'universal'
  /** A universal key of the person looking at it. */
  mine?: boolean
  appName: string | null
  status: string
}

export interface ReviewFollowupRecent {
  id: string
  appName: string | null
  pr_url: string | null
  status: 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped'
  reason: string | null
  /** The detail behind the reason (Cursor's own message for cursor_rejected). */
  error?: string | null
  model: string | null
  findings_count: number | null
  head_sha_before: string
  head_sha_after: string | null
  verdict_after: 'merge' | 'fix_first' | 'hold' | null
  created_at: string
}

export interface ReviewFollowupsResponse {
  available: boolean
  organizationId?: string
  canManage?: boolean
  settings?: ReviewFollowupSettings
  keys?: ReviewFollowupKey[]
  scoreboard?: ReviewFollowupScoreboard
  recent?: ReviewFollowupRecent[]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const VERDICT_WORDS: Record<'merge' | 'fix_first' | 'hold', string> = {
  merge: 'merge',
  fix_first: 'fix first',
  hold: 'hold',
}

/**
 * "Review follow-ups, last 7 days: 12 sent → 9 pushed → Opus after: 4 merge,
 * 3 fix first, 1 hold (50% fix first → merge)", or null before any was sent.
 */
export function followupScoreLine(board: ReviewFollowupScoreboard | null | undefined): string | null {
  if (!board || board.dispatched === 0) return null
  const v = board.verdictsAfter
  const judged = v.merge + v.fix_first + v.hold
  const after = judged > 0 ? ` → Opus after: ${v.merge} merge, ${v.fix_first} fix first, ${v.hold} hold` : ''
  const rate = board.conversionRate != null ? ` (${Math.round(board.conversionRate * 100)}% fix first → merge)` : ''
  const waiting = board.awaitingReview > 0 ? `, ${board.awaitingReview} awaiting review` : ''
  const screened = board.findingsDropped ? `; ${board.findingsDropped} unsafe finding${board.findingsDropped === 1 ? '' : 's'} not sent` : ''
  const running = board.inFlight > 0 ? `, ${board.inFlight} running` : ''
  return `Review follow-ups, last ${plural(board.days, 'day')}: ${board.dispatched} sent → ${board.pushed} pushed, ${board.noChange} no change${running}${after}${rate}${waiting}${screened}`
}

/** How a key reads in the picker. */
export function followupKeyLabel(k: ReviewFollowupKey): string {
  const name = k.label ?? k.keyHint ?? 'Cursor key'
  const owner =
    k.scope === 'organization'
      ? 'shared'
      : k.scope === 'universal'
        ? k.mine
          ? 'your universal key'
          : "an owner's universal key"
        : k.appName
          ? `${k.appName}'s key`
          : "an app's key"
  return `${name} (${owner})${k.status !== 'active' ? ` · ${k.status}` : ''}`
}

/** One recent follow-up in a line. */
export function followupRecentLine(r: ReviewFollowupRecent): string {
  const app = r.appName ?? 'An app'
  switch (r.status) {
    case 'queued':
      return `${app}: queued${r.reason ? `, waiting: ${r.reason}` : ''}`
    case 'dispatched':
    case 'running':
      return `${app}: agent working on ${plural(r.findings_count ?? 0, 'finding')}`
    case 'skipped':
      return `${app}: skipped${r.reason ? `: ${r.reason}` : ''}${r.error ? ` (${r.error.slice(0, 200)})` : ''}`
    case 'completed':
    case 'failed': {
      const pushed = !!r.head_sha_after && r.head_sha_after !== r.head_sha_before
      if (!pushed) return `${app}: ${r.status === 'failed' ? 'agent failed' : 'agent finished'}, no change pushed`
      return `${app}: pushed ${String(r.head_sha_after).slice(0, 7)}${r.verdict_after ? `, Opus: ${VERDICT_WORDS[r.verdict_after]}` : ', awaiting review'}`
    }
  }
}
