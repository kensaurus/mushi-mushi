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
  /** The model for a PR's last follow-up round (ADR 0032 amendment); null = the same model. */
  escalationModel?: string | null
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

function pushedChange(r: ReviewFollowupRecent): boolean {
  return !!r.head_sha_after && r.head_sha_after !== r.head_sha_before
}

/** What one recent follow-up did, without the app name. */
export function followupRecentResult(r: ReviewFollowupRecent): string {
  switch (r.status) {
    case 'queued':
      return `queued${r.reason ? `, waiting: ${r.reason}` : ''}`
    case 'dispatched':
    case 'running':
      return `agent working on ${plural(r.findings_count ?? 0, 'finding')}`
    case 'skipped':
      return `skipped${r.reason ? `: ${r.reason}` : ''}${r.error ? ` (${r.error.slice(0, 200)})` : ''}`
    case 'completed':
    case 'failed': {
      if (!pushedChange(r)) return `${r.status === 'failed' ? 'agent failed' : 'agent finished'}, no change pushed`
      return `pushed ${String(r.head_sha_after).slice(0, 7)}${r.verdict_after ? `, Opus: ${VERDICT_WORDS[r.verdict_after]}` : ', awaiting review'}`
    }
  }
}

/** @internal Exported for tests. One recent follow-up in a line. */
export function followupRecentLine(r: ReviewFollowupRecent): string {
  return `${r.appName ?? 'An app'}: ${followupRecentResult(r)}`
}

/**
 * The mark beside a recent follow-up, so a failure reads as a cross and a push
 * as a tick instead of a plain line of text (round-3 review 2026-11-19).
 */
export function followupRecentMark(
  r: ReviewFollowupRecent,
): 'running' | 'passed' | 'failed' | 'waiting' | 'idle' {
  switch (r.status) {
    case 'queued':
      return 'waiting'
    case 'dispatched':
    case 'running':
      return 'running'
    case 'skipped':
      return 'idle'
    case 'failed':
      return pushedChange(r) ? 'passed' : 'failed'
    case 'completed':
      return pushedChange(r) ? (r.verdict_after ? 'passed' : 'waiting') : 'idle'
  }
}

const MODEL_WORD: Record<string, string> = { gpt: 'GPT', ai: 'AI' }
const PARAM_WORD: Record<string, string> = { context: 'context', reasoning_effort: 'effort' }

/**
 * A Cursor model spec as a person reads it: "grok-4.7?context=500k&reasoning_effort=xhigh"
 * becomes "Grok 4.7 (500k context, xhigh effort)". Settings showed the raw spec.
 */
export function cursorModelName(spec: string): string {
  const text = spec.trim()
  if (!text) return text
  const q = text.indexOf('?')
  const id = q < 0 ? text : text.slice(0, q)
  const name = id
    .split('-')
    .filter(Boolean)
    .map((w) => MODEL_WORD[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  if (q < 0) return name
  const params = text
    .slice(q + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq <= 0) return null
      const key = part.slice(0, eq)
      return `${part.slice(eq + 1)} ${PARAM_WORD[key] ?? key.replace(/_/g, ' ')}`
    })
    .filter(Boolean)
  return params.length > 0 ? `${name} (${params.join(', ')})` : name
}
