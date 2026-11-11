/**
 * FILE: packages/server/src/__tests__/agent-credits.test.ts
 * PURPOSE: Console audit 2026-11-11, blockers 1–3. From 2026-11-07 every fix
 *          run stopped with "You're out of usage", yet:
 *            - the report page said "Add Anthropic key" for a team on OpenAI;
 *            - /fixes called the failures "Unrecognised error" and offered
 *              "Retry 53";
 *            - the worker flag said "Cursor credits idle".
 *          These tests use the real error strings from production.
 */
import { describe, expect, it } from 'vitest'

import { AGENT_OUT_OF_USAGE_BUCKET, isAgentOutOfUsageError } from '../../supabase/functions/_shared/agent-out-of-usage.ts'
import {
  agentCreditsState,
  CLAUDE_WORK_COMMAND,
  fixAgentCheck,
  OUT_OF_USAGE_STREAK_MIN,
  type CreditAttemptRow,
  type CreditKeyRow,
} from '../../supabase/functions/_shared/agent-credits.ts'
import { deriveReportFixTruth } from '../../supabase/functions/_shared/fix-report-truth.ts'
import { CREDITS_OUT_FLAG_ID, deriveWorkerFlags, flagsForProject } from '../../supabase/functions/_shared/work-flags.ts'
import { autofixKeyGap, withFollowupCredits } from '../../supabase/functions/_shared/setup-gaps.ts'
import { fromSetupGap } from '../../supabase/functions/_shared/health-checks.ts'

const LOCAL_OUT =
  "Local agent finished without a change: ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue."
const CLOUD_OUT =
  'Cursor API 400 usage_limit_exceeded: On-demand usage is required. Enable on-demand usage at https://www.cursor.com/dashboard?tab=settings to continue using Background Agents.'
const NOW = new Date('2026-11-11T09:00:00Z')

const keys: CreditKeyRow[] = [
  { label: 'kenji.sakuramoto', status: 'active', exhaustedUntil: '2026-11-21T23:59:59Z', creditsExpireAt: '2026-11-21T23:59:59Z' },
  // Used up by local runs, which never set exhausted_until: its renewal date is when it comes back.
  { label: 'kensaurus', status: 'active', exhaustedUntil: '2026-10-31T02:37:40Z', creditsExpireAt: '2026-11-19T23:59:59Z' },
  { label: 'suzu.haruka', status: 'disabled', exhaustedUntil: null, creditsExpireAt: '2026-10-31T23:59:59Z' },
]

function refusedRuns(n: number, from = Date.parse('2026-11-07T00:15:00Z')): CreditAttemptRow[] {
  return Array.from({ length: n }, (_, i) => ({ agent: 'mcp', status: 'failed', error: LOCAL_OUT, createdAt: new Date(from + i * 3600_000).toISOString() }))
}

describe('isAgentOutOfUsageError', () => {
  it('matches the local Cursor CLI and Cursor Cloud refusals', () => {
    expect(isAgentOutOfUsageError(LOCAL_OUT)).toBe(true)
    expect(isAgentOutOfUsageError(CLOUD_OUT)).toBe(true)
  })
  it('does not match a rate limit, an auth error or another ActionRequiredError', () => {
    expect(isAgentOutOfUsageError('Cursor API error 429: rate limited, try again')).toBe(false)
    expect(isAgentOutOfUsageError('Local agent finished without a change: ActionRequiredError: Unauthorized request. Invalid internal service header')).toBe(false)
    expect(isAgentOutOfUsageError('Local agent finished without a change: ActionRequiredError: AI Model Not Found Model name is not valid: "grok-4.7"')).toBe(false)
    expect(isAgentOutOfUsageError(null)).toBe(false)
  })
})

describe('agentCreditsState', () => {
  it('is out after a streak of refusals, since the first one, back on the earliest renewal', () => {
    const s = agentCreditsState({ keys, attempts: refusedRuns(53), now: NOW })
    expect(s.out).toBe(true)
    expect(s.refused).toBe(53)
    expect(s.since).toBe('2026-11-07T00:15:00.000Z')
    expect(s.backAt).toBe('2026-11-19T23:59:59.000Z')
    expect(s.backLabel).toBe('kensaurus')
  })
  it('is not out on fewer refusals than the streak needs, or when a newer run worked', () => {
    expect(agentCreditsState({ keys, attempts: refusedRuns(OUT_OF_USAGE_STREAK_MIN - 1), now: NOW }).out).toBe(false)
    const worked: CreditAttemptRow = { agent: 'mcp', status: 'completed', error: null, createdAt: '2026-11-10T00:00:00Z' }
    expect(agentCreditsState({ keys: [], attempts: [...refusedRuns(10), worked], now: NOW }).out).toBe(false)
  })
  it('skips runs still going', () => {
    const live: CreditAttemptRow = { agent: 'mcp', status: 'running', error: null, createdAt: '2026-11-11T08:00:00Z' }
    expect(agentCreditsState({ keys: [], attempts: [live, ...refusedRuns(3)], now: NOW }).out).toBe(true)
  })
  it('clears on its own once a key renews after the refusals began (nothing runs meanwhile)', () => {
    const nov20 = new Date('2026-11-20T09:00:00Z')
    // kensaurus renewed on Nov 19; kenji.sakuramoto is still used up until Nov 21.
    expect(agentCreditsState({ keys, attempts: refusedRuns(53), now: nov20 }).out).toBe(false)
    // A key added after the refusals began may have credits too.
    const added = { label: 'new', status: 'active', exhaustedUntil: null, creditsExpireAt: null, createdAt: '2026-11-10T00:00:00Z' }
    expect(agentCreditsState({ keys: [keys[0]!, added], attempts: refusedRuns(53), now: NOW }).out).toBe(false)
  })

  it('is out when every active Cursor key is marked used up, with no runs', () => {
    const s = agentCreditsState({ keys: [{ ...keys[0]! }], attempts: [], now: NOW })
    expect(s).toMatchObject({ out: true, since: null, backAt: '2026-11-21T23:59:59.000Z' })
  })
})

describe('fixAgentCheck (dispatch preflight)', () => {
  const base = { autofixAgent: 'claude_code', aiProvider: 'openai' as const, hasAnthropicKey: false, hasOpenaiKey: true, cursorKeys: [] }
  it('asks for the OpenAI key, not an Anthropic one, for a team on OpenAI', () => {
    const c = fixAgentCheck(base, NOW)
    expect(c).toMatchObject({ key: 'agent', ready: true, agent: 'llm' })
    expect(c.label).toContain('OpenAI')
    const missing = fixAgentCheck({ ...base, hasOpenaiKey: false, hasAnthropicKey: true }, NOW)
    expect(missing.ready).toBe(false)
    expect(missing.hint).toContain('OpenAI')
  })
  it('accepts either key on the default Anthropic team (OpenAI is the fallback)', () => {
    expect(fixAgentCheck({ ...base, aiProvider: 'anthropic' }, NOW).ready).toBe(true)
    expect(fixAgentCheck({ ...base, aiProvider: 'anthropic', hasOpenaiKey: false }, NOW).ready).toBe(false)
  })
  it('names Cursor out of credits with the date, and the Claude Code remedy', () => {
    const c = fixAgentCheck({ ...base, autofixAgent: 'cursor_cloud', cursorKeys: [keys[0]!] }, NOW)
    expect(c).toMatchObject({ ready: false, label: 'Cursor is out of credits', outUntil: '2026-11-21T23:59:59.000Z' })
    expect(c.hint).toContain('Nov 21')
    expect(c.hint).toContain(CLAUDE_WORK_COMMAND)
  })
})

describe('fix truth: out-of-usage failures get their own bucket', () => {
  it('names them; whether Retry shows is the live credits state, not the row', () => {
    const t = deriveReportFixTruth({
      reportId: 'r1',
      report: { id: 'r1', status: 'classified' },
      attempts: [{ id: 'a1', report_id: 'r1', status: 'failed', error: LOCAL_OUT, failure_category: null, created_at: '2026-11-08T00:00:00Z' }],
    })
    expect(t).toMatchObject({ state: 'failed', retryable: true, failureBucket: AGENT_OUT_OF_USAGE_BUCKET })
  })
  it('keeps other failures retryable', () => {
    const t = deriveReportFixTruth({
      reportId: 'r1',
      report: { id: 'r1', status: 'classified' },
      attempts: [{ id: 'a1', report_id: 'r1', status: 'failed', error: 'sandbox exploded', failure_category: null, created_at: '2026-11-08T00:00:00Z' }],
    })
    expect(t.retryable).toBe(true)
  })
})

describe('worker flags and the health gap say "out of credits", with the remedy', () => {
  const out = agentCreditsState({ keys, attempts: refusedRuns(53), now: NOW })
  it('raises one danger flag naming the date, even with no lanes', () => {
    const flags = deriveWorkerFlags({ hosts: [], lanes: [], claims: [], localRuns: [], credits: [], agentCredits: out, now: NOW })
    const f = flags.find((x) => x.id === CREDITS_OUT_FLAG_ID)!
    expect(f.severity).toBe('danger')
    expect(f.title).toBe('Automatic fixes are out of credits since Nov 7')
    expect(f.cause).toContain('Nov 19')
    expect(f.title).not.toMatch(/idle/i)
    expect(f.actions.some((a) => a.kind === 'copy_command' && a.command === CLAUDE_WORK_COMMAND)).toBe(true)
    expect(flagsForProject(flags, [], 'any-app')).toContain(f)
  })
  it('makes the auto-fix gap a guided fix with the commands', () => {
    const gap = autofixKeyGap({ projectId: 'p1', dispatcher: { autofixOn: true, server: { agentKeys: 0, offKeys: 2 } }, credits: out })
    expect(gap.status).toBe('gap')
    expect(gap.title).toBe('Automatic fixes are out of credits since Nov 7')
    // Dispatch fix still runs on the team's own AI key: the summary says so.
    expect(gap.summary).toContain("your team's own AI key")
    const check = fromSetupGap(gap, null)
    expect(check.fix?.kind).toBe('guided')
    expect(check.fix && 'steps' in check.fix ? check.fix.steps.join(' ') : '').toContain('work --agent claude')
  })
  it('turns "follow-ups are on and their key is active" into a gap while out of credits', () => {
    const ok = { id: 'review_followup_key', projectId: 'p1', audience: 'app_owner' as const, status: 'ok' as const, title: 'Review follow-up key', summary: 'Review follow-ups are on and their Cursor key is active.', fixHref: '/settings' }
    const g = withFollowupCredits(ok, out)
    expect(g.status).toBe('gap')
    expect(g.steps?.join(' ')).toContain('--followups')
    expect(withFollowupCredits(ok, null)).toBe(ok)
  })

  it('leaves the gap as before when credits are fine', () => {
    const gap = autofixKeyGap({ projectId: 'p1', dispatcher: { autofixOn: true, server: { agentKeys: 1, offKeys: 0 } }, credits: null })
    expect(gap.status).toBe('ok')
  })
})
