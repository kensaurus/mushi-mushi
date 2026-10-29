/**
 * FILE: fresh-eyes-queue.test.ts
 * PURPOSE: The rules of "Run now" for the first-time user test (fresh-eyes
 *          runs, ADR 0053 amendment 2026-10-28), with no I/O: what the
 *          console may queue, where a run starts by default (the app's own
 *          address, never Mushi's landing for another app), who may use test
 *          accounts, whether a computer can take the run, when a grant to mint
 *          accounts is usable, and what a run row says after its claim ends.
 */

import { describe, expect, it } from 'vitest'
import {
  accountGrantUsable,
  canUseTestAccount,
  defaultStartUrl,
  freshEyesClaimTarget,
  freshEyesRunner,
  MUSHI_LANDING_URL,
  newLocalRunId,
  parseFreshEyesRequest,
  queuedRunExpired,
  runnerRefusal,
  uxRunAfterClaim,
  type RunnerHost,
  type RunnerLane,
} from '../../supabase/functions/_shared/fresh-eyes-queue.ts'

const NOW = new Date('2026-10-28T09:00:00Z')
const OP = '0f000000-0000-4000-8000-00000000000a'
const SELF = '0e000000-0000-4000-8000-00000000000e'
const GLOT = '1a000000-0000-4000-8000-000000000000'

describe('parseFreshEyesRequest', () => {
  it('takes a start page, a goal and the closed options', () => {
    const r = parseFreshEyesRequest({ url: 'https://glot.it/', goal: '  sign up   and pick a language ', sessions: 2, successText: 'Your lessons', dryRun: true })
    expect(r).toEqual({ ok: true, value: { url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 2, successText: 'Your lessons', dryRun: true, withAccount: false } })
  })

  it('defaults to 3 visitors and filing what stops them', () => {
    const r = parseFreshEyesRequest({ url: 'https://glot.it', goal: 'learn a word' })
    expect(r.ok && r.value).toMatchObject({ sessions: 3, dryRun: false, withAccount: false, successText: null })
  })

  it.each([
    [{ url: 'javascript:alert(1)', goal: 'x' }, 'web address'],
    [{ url: 'https://user:pw@glot.it', goal: 'x' }, 'web address'],
    [{ url: 'https://glot.it', goal: '' }, 'few words'],
    [{ url: 'https://glot.it', goal: '--mint-account' }, 'few words'],
    [{ url: 'https://glot.it', goal: 'a\u0007b' }, 'few words'],
    [{ url: 'https://glot.it', goal: 'x', sessions: 9 }, '1 to 5'],
    [{ url: 'https://glot.it', goal: 'x', dryRun: true, withAccount: true }, 'Pick one'],
    [{ url: 'https://glot.it', goal: 'x', command: 'rm -rf /' }, 'Unknown field'],
  ])('refuses %j', (body, words) => {
    const r = parseFreshEyesRequest(body)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain(words)
  })
})

describe('newLocalRunId', () => {
  it('is the CLI run-id format, in UTC', () => {
    expect(newLocalRunId(new Date('2026-10-28T09:05:07Z'), new Uint8Array([0, 1, 26, 35]))).toBe('20261028-090507-ab09')
  })
})

describe('defaultStartUrl', () => {
  it("starts another app on its own address, never on Mushi's landing", () => {
    expect(defaultStartUrl({ siteWatch: 'https://glot.it', siteAudit: null, crawler: null, isMushi: false })).toEqual({ url: 'https://glot.it/', source: 'site_watch' })
    expect(defaultStartUrl({ siteWatch: null, siteAudit: 'https://glot.it/en', crawler: 'https://x.test', isMushi: false })).toEqual({ url: 'https://glot.it/en', source: 'site_audit' })
    expect(defaultStartUrl({ siteWatch: null, siteAudit: null, crawler: 'https://glot.it', isMushi: false })?.source).toBe('crawler')
  })

  it('prefers the last test, and leaves it empty when the app has no known address', () => {
    expect(defaultStartUrl({ lastRun: 'https://glot.it/start', siteWatch: 'https://glot.it', isMushi: false })?.source).toBe('last_run')
    expect(defaultStartUrl({ siteWatch: 'not a url', isMushi: false })).toBeNull()
  })

  it("uses Mushi's landing only for Mushi itself", () => {
    expect(defaultStartUrl({ isMushi: true })).toEqual({ url: MUSHI_LANDING_URL, source: 'mushi' })
  })
})

describe('canUseTestAccount', () => {
  it("is an operator's console session on Mushi's own project only", () => {
    expect(canUseTestAccount({ isOperator: true, authMethod: 'jwt', projectId: SELF, selfProjectId: SELF })).toBe(true)
    expect(canUseTestAccount({ isOperator: true, authMethod: 'jwt', projectId: GLOT, selfProjectId: SELF })).toBe(false)
    expect(canUseTestAccount({ isOperator: false, authMethod: 'jwt', projectId: SELF, selfProjectId: SELF })).toBe(false)
    expect(canUseTestAccount({ isOperator: true, authMethod: 'apiKey', projectId: SELF, selfProjectId: SELF })).toBe(false)
    expect(canUseTestAccount({ isOperator: true, authMethod: 'jwt', projectId: SELF, selfProjectId: undefined })).toBe(false)
  })
})

describe('freshEyesRunner', () => {
  const host = (over: Partial<RunnerHost> = {}): RunnerHost => ({ id: 'h1', hostname: 'alienware', last_heartbeat_at: '2026-10-28T08:59:30Z', revoked_at: null, takes: ['fresh_eyes'], ...over })
  const lane = (over: Partial<RunnerLane> = {}): RunnerLane => ({ host_id: 'h1', mode: 'fix', paused: false, drain: false, stop_at: null, concurrency: 1, ...over })
  const none = new Map<string, number>()

  it('says none when the app has no worker lane', () => {
    expect(freshEyesRunner([], [], none, NOW).state).toBe('none')
    expect(freshEyesRunner([lane()], [host({ revoked_at: '2026-10-27T00:00:00Z' })], none, NOW).state).toBe('none')
  })

  it('says offline with the last heartbeat', () => {
    expect(freshEyesRunner([lane()], [host({ last_heartbeat_at: '2026-10-28T06:00:00Z' })], none, NOW)).toEqual({ state: 'offline', hostname: 'alienware', lastSeenAt: '2026-10-28T06:00:00Z' })
  })

  it('says outdated when the daemon never said it runs first-time user tests', () => {
    expect(freshEyesRunner([lane()], [host({ takes: [] })], none, NOW).state).toBe('outdated')
    expect(freshEyesRunner([lane()], [host({ takes: null })], none, NOW).state).toBe('outdated')
  })

  it('says paused when no lane of the app claims', () => {
    expect(freshEyesRunner([lane({ paused: true }), lane({ mode: 'followups' }), lane({ drain: true }), lane({ stop_at: '2026-10-27T00:00:00Z' })], [host()], none, NOW).state).toBe('paused')
  })

  it('says ready, or busy while every claiming lane runs its limit', () => {
    expect(freshEyesRunner([lane({ mode: 'audit' })], [host()], none, NOW)).toEqual({ state: 'ready', hostname: 'alienware', lastSeenAt: '2026-10-28T08:59:30Z' })
    expect(freshEyesRunner([lane()], [host()], new Map([['h1', 1]]), NOW).state).toBe('busy')
  })

  it('refuses Run now in plain words with the one thing to do', () => {
    expect(runnerRefusal({ state: 'ready', hostname: 'a', lastSeenAt: null })).toBeNull()
    expect(runnerRefusal({ state: 'busy', hostname: 'a', lastSeenAt: null })).toBeNull()
    expect(runnerRefusal({ state: 'none', hostname: null, lastSeenAt: null })).toContain('Pipeline → Workers')
    expect(runnerRefusal({ state: 'offline', hostname: 'alienware', lastSeenAt: null })).toContain('alienware is not online')
    expect(runnerRefusal({ state: 'outdated', hostname: 'alienware', lastSeenAt: null })).toContain('npm i -g @mushi-mushi/cli@latest')
  })
})

describe('accountGrantUsable', () => {
  const row = { account_granted_by: OP, account_grant_until: '2026-10-28T10:00:00Z', project_id: SELF }
  const ctx = { hostOwnerId: OP, isOperator: (id: string) => id === OP, selfProjectId: SELF, now: NOW }

  it("lets the operator's own computer mint, on Mushi, inside the grant", () => {
    expect(accountGrantUsable(row, ctx)).toBe(true)
  })

  it('refuses another person’s computer, an expired grant, a non-operator and another app', () => {
    expect(accountGrantUsable(row, { ...ctx, hostOwnerId: 'someone-else' })).toBe(false)
    expect(accountGrantUsable({ ...row, account_grant_until: '2026-10-28T08:00:00Z' }, ctx)).toBe(false)
    expect(accountGrantUsable(row, { ...ctx, isOperator: () => false })).toBe(false)
    expect(accountGrantUsable({ ...row, project_id: GLOT }, ctx)).toBe(false)
    expect(accountGrantUsable({ ...row, account_granted_by: null }, ctx)).toBe(false)
  })
})

describe('the claim and its end', () => {
  it('carries the run, never more accounts than given', () => {
    const t = freshEyesClaimTarget(
      { id: 'u1', local_run_id: '20261028-090000-abcd', project_id: GLOT, start_url: 'https://glot.it/', goal: 'learn', sessions_requested: 2, success_text: null, dry_run: true, started_at: '', account_granted_by: null, account_grant_until: null },
      [],
    )
    expect(t).toEqual({ runId: '20261028-090000-abcd', url: 'https://glot.it/', goal: 'learn', sessions: 2, successText: null, dryRun: true, accounts: [] })
  })

  it('leaves a run the CLI finished alone, and says why one ended early', () => {
    expect(uxRunAfterClaim('ran', null, 'done')).toBeNull()
    expect(uxRunAfterClaim('failed', 'x', 'failed')).toBeNull()
    expect(uxRunAfterClaim('failed', 'mushi-ux could not start on this computer: ENOENT', 'running')).toEqual({ status: 'failed', detail: 'mushi-ux could not start on this computer: ENOENT' })
    expect(uxRunAfterClaim('stopped', null, 'running')).toEqual({ status: 'stopped', detail: 'The computer stopped before the test finished.' })
    expect(uxRunAfterClaim('lease_expired', null, 'running')?.detail).toContain('stopped answering')
    expect(uxRunAfterClaim('ran', 'sync refused', 'running')?.status).toBe('failed')
  })

  it('gives up on a run nobody took within a day', () => {
    expect(queuedRunExpired('2026-10-27T08:59:00Z', NOW)).toBe(true)
    expect(queuedRunExpired('2026-10-28T08:00:00Z', NOW)).toBe(false)
  })
})
