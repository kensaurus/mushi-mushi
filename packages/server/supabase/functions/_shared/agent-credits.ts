/**
 * FILE: packages/server/supabase/functions/_shared/agent-credits.ts
 * PURPOSE: Two answers the console got wrong on 2026-11-11 (console audit,
 *          blockers 1–3):
 *
 *   1. agentCreditsState: do the agents that open fixes on their own
 *      (Cursor Cloud and the local `mushi work` lanes) have credits? From
 *      2026-11-07 every run stopped with "You're out of usage", yet Spend
 *      credits said "Room for up to 440 more fixes", the worker flag said
 *      "Cursor credits idle", and Pipeline said "Nothing is stuck". The
 *      answer comes from evidence: the newest finished runs, and the Cursor
 *      keys' own `exhausted_until`.
 *
 *   2. fixAgentCheck: the dispatch preflight's agent line. It used to demand
 *      an Anthropic key for every app, also for an organization that runs AI
 *      on OpenAI (ADR 0039 amendment), where the fix-worker writes fixes with
 *      the OpenAI key and no Claude key is ever handed out. Adding an
 *      Anthropic key changed nothing. The line now checks the agent that
 *      runs the fix: the project's `autofix_agent`, and for the default LLM
 *      path the organization's provider.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 * The reads are in agent-credits-load.ts.
 */

import { isAgentOutOfUsageError } from './agent-out-of-usage.ts'

/** Runs refused in a row before the agents count as out of credits (one refusal can be a spike). */
export const OUT_OF_USAGE_STREAK_MIN = 3

/** The command that fixes reports with Claude Code on the user's own computer (`mushi work --agent claude`). */
export const CLAUDE_WORK_COMMAND = 'npx @mushi-mushi/cli@latest work --agent claude --repo-dir .'
/** The same, for the review findings on PRs `mushi work` opened (the held PRs wait on these). */
export const CLAUDE_FOLLOWUPS_COMMAND = 'npx @mushi-mushi/cli@latest work --agent claude --followups --repo-dir .'

export interface CreditKeyRow {
  label: string | null
  status: string
  /** Set by Mushi when Cursor refused the key for its usage limit (agent-adapters.ts). */
  exhaustedUntil: string | null
  /** The date saved for the key in Spend credits: when its credits lapse or renew. */
  creditsExpireAt: string | null
  /** When the key was added; a key added after the refusals began may have credits. */
  createdAt?: string | null
}

export interface CreditAttemptRow {
  agent: string | null
  status: string | null
  error: string | null
  createdAt: string
}

export interface AgentCreditsState {
  /** True when the agents that open fixes on their own have no credits. */
  out: boolean
  /** When the run of refusals began (the oldest refused run in the streak), if known. */
  since: string | null
  /** How many runs in a row were refused. */
  refused: number
  /** The earliest date a Cursor key's credits come back, if known. */
  backAt: string | null
  /** Which key that date belongs to ("kensaurus"). */
  backLabel: string | null
}

export const NO_CREDITS_STATE: AgentCreditsState = { out: false, since: null, refused: 0, backAt: null, backLabel: null }

const LIVE = new Set(['queued', 'running', 'pending', 'dispatched'])

function future(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) && t > nowMs ? t : null
}

/**
 * Out of credits when the newest finished runs (at least
 * OUT_OF_USAGE_STREAK_MIN in a row, nothing finished after them) all stopped
 * on the agent's usage limit, or when every active Cursor key is marked used
 * up. The date they come back: the earliest active key's `exhausted_until`,
 * else the date saved for it (its renewal) when that is still ahead.
 *
 * It ends on its own: nothing runs while it lasts, so the refused runs stay
 * the newest. Once an active key's date (`exhausted_until`, or the renewal
 * saved for it) has passed since the refusals began, or a key was added after
 * they began, the credits may be back and the state clears. A new refusal
 * starts it again.
 */
export function agentCreditsState(input: { keys: readonly CreditKeyRow[]; attempts: readonly CreditAttemptRow[]; now: Date }): AgentCreditsState {
  const nowMs = input.now.getTime()
  const finished = input.attempts
    .filter((a) => !LIVE.has((a.status ?? '').toLowerCase()) && Number.isFinite(Date.parse(a.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  let refused = 0
  let since: string | null = null
  for (const a of finished) {
    if ((a.status ?? '').toLowerCase() !== 'failed' || !isAgentOutOfUsageError(a.error)) break
    refused++
    since = a.createdAt
  }
  const active = input.keys.filter((k) => k.status === 'active')
  const allKeysUsedUp = active.length > 0 && active.every((k) => future(k.exhaustedUntil, nowMs) !== null)
  const sinceMs = since ? Date.parse(since) : NaN
  const passedSince = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) && Number.isFinite(sinceMs) && t > sinceMs && t <= nowMs
  }
  const maybeBack = active.some(
    (k) => future(k.exhaustedUntil, nowMs) === null && (passedSince(k.exhaustedUntil) || passedSince(k.creditsExpireAt) || passedSince(k.createdAt)),
  )
  const out = allKeysUsedUp || (refused >= OUT_OF_USAGE_STREAK_MIN && !maybeBack)
  if (!out) return NO_CREDITS_STATE
  let backMs: number | null = null
  let backLabel: string | null = null
  for (const k of active) {
    const t = future(k.exhaustedUntil, nowMs) ?? future(k.creditsExpireAt, nowMs)
    if (t !== null && (backMs === null || t < backMs)) {
      backMs = t
      backLabel = k.label
    }
  }
  return { out, since: refused > 0 ? since : null, refused, backAt: backMs === null ? null : new Date(backMs).toISOString(), backLabel }
}

/** "Nov 19" */
export function shortDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * "Automatic fixes are out of credits since Nov 7" (the one title every
 * surface uses). Not "no fix agent": Dispatch fix on a bug can still run on
 * the team's own AI key (fixAgentCheck), which these credits do not touch.
 */
export function agentCreditsTitle(s: AgentCreditsState): string {
  return s.since ? `Automatic fixes are out of credits since ${shortDay(s.since)}` : 'Automatic fixes are out of credits'
}

/** Plain sentences on why, when it ends, and what still works. */
export function agentCreditsSummary(s: AgentCreditsState): string {
  const why = s.refused > 0
    ? `The last ${s.refused} fix run${s.refused === 1 ? '' : 's'} that start on their own (Cursor and your local workers) stopped because the coding agent's account is out of usage, so nothing opens a fix by itself.`
    : 'Every Cursor key is out of credits, so nothing opens a fix by itself.'
  const back = s.backAt
    ? ` Cursor's credits come back on ${shortDay(s.backAt)}${s.backLabel ? ` (key "${s.backLabel}")` : ''}.`
    : ''
  return `${why}${back} Until then, run the fixes with Claude Code on your own computer. Dispatch fix on a bug page still works where it says the AI key for writing fixes is ready: that uses your team's own AI key, not these credits.`
}

// ── Dispatch preflight: the agent line ─────────────────────────────────────

export interface PreflightAgentCheck {
  key: 'agent'
  ready: boolean
  label: string
  hint: string
  fixHref: string
  /** The agent the fix runs on, for the console's wording. */
  agent: 'llm' | 'cursor_cloud' | 'github_cloud_agent' | 'local' | 'other'
  /** Set when the agent is out of credits: until when, if known. */
  outUntil?: string | null
}

export interface FixAgentSignals {
  /** project_settings.autofix_agent (null: the default, claude_code). */
  autofixAgent: string | null
  aiProvider: 'anthropic' | 'openai'
  hasAnthropicKey: boolean
  hasOpenaiKey: boolean
  /** The app's Cursor keys (only read for cursor_cloud). */
  cursorKeys: readonly CreditKeyRow[]
}

const LLM_AGENTS = new Set(['claude_code', 'rest_fix_worker', 'rest_worker', 'llm', 'auto'])

/** Which agent runs a dispatched fix (fix-worker's own normalisation). */
export function fixAgentKind(autofixAgent: string | null): PreflightAgentCheck['agent'] {
  const a = (autofixAgent ?? '').trim()
  if (!a || LLM_AGENTS.has(a)) return 'llm'
  if (a === 'cursor_cloud') return 'cursor_cloud'
  if (a === 'github_cloud_agent') return 'github_cloud_agent'
  if (a === 'mcp') return 'local'
  return 'other'
}

export function fixAgentCheck(s: FixAgentSignals, now: Date): PreflightAgentCheck {
  const agent = fixAgentKind(s.autofixAgent)
  const keysHref = '/settings?tab=byok'
  if (agent === 'llm') {
    // fix-worker's LLM path: Anthropic first, OpenAI as the fallback; an
    // organization on OpenAI gets no Claude key at all (resolveLlmKeys).
    if (s.aiProvider === 'openai') {
      return s.hasOpenaiKey
        ? { key: 'agent', agent, ready: true, label: 'AI key for writing fixes (OpenAI)', hint: 'Your team runs AI on OpenAI, so fixes are written with the OpenAI key.', fixHref: keysHref }
        : { key: 'agent', agent, ready: false, label: 'AI key for writing fixes (OpenAI)', hint: 'Your team runs AI on OpenAI. Add an OpenAI key under Settings → AI keys so Mushi Mushi can write the fix.', fixHref: keysHref }
    }
    if (s.hasAnthropicKey || s.hasOpenaiKey) {
      return { key: 'agent', agent, ready: true, label: `AI key for writing fixes (${s.hasAnthropicKey ? 'Anthropic' : 'OpenAI'})`, hint: 'Fixes are written with Claude first, and OpenAI when Claude is not available.', fixHref: keysHref }
    }
    return { key: 'agent', agent, ready: false, label: 'AI key for writing fixes', hint: 'Add an Anthropic or OpenAI key under Settings → AI keys so Mushi Mushi can write the fix.', fixHref: keysHref }
  }
  if (agent === 'cursor_cloud') {
    const nowMs = now.getTime()
    const active = s.cursorKeys.filter((k) => k.status === 'active')
    if (active.length === 0) {
      return { key: 'agent', agent, ready: false, label: 'Cursor key for the fix agent', hint: 'Fixes on this app run on Cursor, and it has no active Cursor key. Add one, or switch the fix agent to Mushi Mushi\'s own writer.', fixHref: '/credits#cursor-fix-bugs' }
    }
    const usable = active.filter((k) => future(k.exhaustedUntil, nowMs) === null)
    if (usable.length === 0) {
      const back = active.map((k) => future(k.exhaustedUntil, nowMs)).filter((t): t is number => t !== null).sort((a, b) => a - b)[0] ?? null
      const until = back === null ? null : new Date(back).toISOString()
      return {
        key: 'agent',
        agent,
        ready: false,
        label: 'Cursor is out of credits',
        hint: `Cursor refused the last run for its usage limit${until ? `; its credits come back on ${shortDay(until)}` : ''}. Until then, fix with Claude Code on your own computer (${CLAUDE_WORK_COMMAND}) or copy the fix prompt into your editor.`,
        fixHref: '/credits#agent-credits',
        outUntil: until,
      }
    }
    return { key: 'agent', agent, ready: true, label: 'Cursor key for the fix agent', hint: `${usable.length} Cursor key${usable.length === 1 ? '' : 's'} can start a fix.`, fixHref: '/credits#cursor-fix-bugs' }
  }
  if (agent === 'github_cloud_agent') {
    return { key: 'agent', agent, ready: true, label: 'GitHub\'s coding agent', hint: 'Fixes on this app run on GitHub\'s coding agent, with the GitHub connection above.', fixHref: '/integrations/config#platform-card-github' }
  }
  if (agent === 'local') {
    return { key: 'agent', agent, ready: false, label: 'Fix agent on your own computer', hint: `Fixes on this app run on your computer, not from this button. Run ${CLAUDE_WORK_COMMAND} there, or copy the fix prompt into your editor.`, fixHref: '/credits#agent-credits' }
  }
  return { key: 'agent', agent, ready: false, label: 'Fix agent', hint: `The fix agent "${s.autofixAgent}" cannot run from the console. Pick Mushi Mushi's own writer under Integrations → Auto-fix agent.`, fixHref: '/integrations/config#integrations-codebase' }
}
