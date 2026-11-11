/**
 * FILE: apps/admin/src/lib/agentCredits.ts
 * PURPOSE: "Do the fix agents have credits?" for every console surface that
 *          offers to start or retry a fix (console audit 2026-11-11,
 *          blockers 1–3). From 2026-11-07 every run stopped with "You're out
 *          of usage" while /fixes offered "Retry 53", Spend credits said
 *          "Room for up to 440 more fixes" and the sidebar said "idle".
 *
 *          Data: `agentCredits` and `hasWorker` on GET /v1/admin/work/stats
 *          (server `_shared/agent-credits.ts`). An older server sends
 *          neither: the console then says nothing new, it never guesses.
 *
 *          The error test mirrors the server's `agent-out-of-usage.ts`, so
 *          rows read before the server ships are classified the same way.
 */

import { usePageData } from './usePageData'

export interface AgentCreditsState {
  out: boolean
  since: string | null
  refused: number
  backAt: string | null
  backLabel: string | null
}

interface WorkStatsResponse {
  flags: number
  danger: number
  top: string | null
  agentCredits?: AgentCreditsState
  hasWorker?: boolean
}

/**
 * Through npx, so they run with no global install (re-audit 2026-11-11: a
 * bare `mushi` is "command not found" on a computer that never installed it).
 */
export const CLAUDE_WORK_COMMAND = 'npx @mushi-mushi/cli@latest work --agent claude --repo-dir .'
export const CLAUDE_FOLLOWUPS_COMMAND = 'npx @mushi-mushi/cli@latest work --agent claude --followups --repo-dir .'
/** What must already be signed in for either command to do anything. */
export const CLAUDE_WORK_NEEDS = [
  { what: 'Claude Code signed in', command: 'claude auth login' },
  { what: 'GitHub CLI signed in', command: 'gh auth login' },
  { what: 'you signed in to Mushi Mushi', command: 'npx @mushi-mushi/cli@latest login' },
] as const

/** "Nov 19" */
function creditsDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "Automatic fixes are out of credits since Nov 7" (same words as the server). */
export function agentCreditsTitle(s: AgentCreditsState): string {
  return s.since ? `Automatic fixes are out of credits since ${creditsDay(s.since)}` : 'Automatic fixes are out of credits'
}

/** "Cursor's credits come back on Nov 19 (key "kensaurus")." or null. */
export function creditsBackLine(s: AgentCreditsState): string | null {
  if (!s.backAt) return null
  return `Cursor's credits come back on ${creditsDay(s.backAt)}${s.backLabel ? ` (key "${s.backLabel}")` : ''}.`
}

export interface AgentCreditsRead {
  /** null while loading, on an older server, or when the read failed. */
  state: AgentCreditsState | null
  /** The caller has a registered local worker; false when unknown. */
  hasWorker: boolean
  loading: boolean
}

export function useAgentCredits(): AgentCreditsRead {
  const { data, loading } = usePageData<WorkStatsResponse>('/v1/admin/work/stats')
  return { state: data?.agentCredits ?? null, hasWorker: data?.hasWorker === true, loading }
}
