/**
 * FILE: setup-gaps.test.ts
 * PURPOSE: The setup-gaps rules (console ops plan 2026-10-27, P1): what the
 *          GitHub token can do from the App's permissions, a classic token's
 *          scopes or a fine-grained token's reads (writes are never proven by
 *          reading); the 14-day deploy rule; follow-up key, auto-fix key and
 *          Slack lines; platform secrets as present/missing only; audience
 *          filtering; and the 10-minute cache.
 */
import { describe, expect, it } from 'vitest'
import {
  abilitiesFromClassicScopes,
  abilitiesFromInstallation,
  abilitiesFromReadProbes,
  autofixKeyGap,
  countByStatus,
  createTtlCache,
  deployGap,
  DEPLOY_SILENCE_DAYS,
  followupKeyGap,
  forAudience,
  githubAccessGap,
  noRepoGap,
  SETUP_GAPS_CACHE_MS,
  slackGap,
  sortGaps,
  type SetupGap,
} from '../../supabase/functions/_shared/setup-gaps.ts'
import { platformGaps } from '../../supabase/functions/_shared/platform-setup-checks.ts'

const P = 'p1'
const NOW = new Date('2026-10-27T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000).toISOString()

describe('GitHub abilities', () => {
  it('reads the App installation permissions (write = yes; read or absent = cannot)', () => {
    expect(abilitiesFromInstallation({ contents: 'write', pull_requests: 'write', actions: 'read', metadata: 'read' }, true)).toEqual({
      contents: 'yes',
      pullRequests: 'yes',
      actions: 'no',
      secrets: 'no',
    })
  })

  it('a repo outside the installation can do nothing; no permissions in the answer is unknown', () => {
    expect(abilitiesFromInstallation({ contents: 'write' }, false)).toEqual({ contents: 'no', pullRequests: 'no', actions: 'no', secrets: 'no' })
    expect(abilitiesFromInstallation(null, true).contents).toBe('unknown')
  })

  it('reads a classic token scope header', () => {
    expect(abilitiesFromClassicScopes('read:org, repo, workflow', true)).toEqual({ contents: 'yes', pullRequests: 'yes', actions: 'yes', secrets: 'yes' })
    expect(abilitiesFromClassicScopes('public_repo', true)).toEqual({ contents: 'yes', pullRequests: 'yes', actions: 'unknown', secrets: 'no' })
    expect(abilitiesFromClassicScopes('read:org', true).contents).toBe('no')
    expect(abilitiesFromClassicScopes('repo', false).contents).toBe('no')
  })

  it('a fine-grained token: a working read proves only reading; 403/404 proves it is missing; no answer is unknown', () => {
    expect(abilitiesFromReadProbes({ contents: 200, pullRequests: 200, actions: 403, secrets: 404 })).toEqual({
      contents: 'read_only',
      pullRequests: 'read_only',
      actions: 'no',
      secrets: 'no',
    })
    expect(abilitiesFromReadProbes({ contents: null, pullRequests: 502, actions: 200, secrets: 200 })).toMatchObject({ contents: 'unknown', pullRequests: 'unknown' })
  })
})

describe('githubAccessGap', () => {
  const line = (over: Partial<Parameters<typeof githubAccessGap>[0]>) =>
    githubAccessGap({ projectId: P, repo: 'kensaurus/glot.it', source: 'app', abilities: { contents: 'yes', pullRequests: 'yes', actions: 'yes', secrets: 'no' }, readError: null, ...over })

  it('the App without secrets is not a gap: the owner gets copy-paste commands instead', () => {
    const g = line({})
    expect(g.status).toBe('ok')
    expect(g.summary).toContain("can't write CI secrets; Mushi gives you copy-paste commands")
    expect(g.fixHref).toBe('/connect#connect-github')
  })

  it('a missing core permission is a gap that names it (the GITHUB_ACTIONS_WRITE_MISSING case)', () => {
    expect(line({ abilities: { contents: 'yes', pullRequests: 'yes', actions: 'read_only', secrets: 'no' } }).status).toBe('unknown')
    const gap = line({ abilities: { contents: 'yes', pullRequests: 'yes', actions: 'no', secrets: 'no' } })
    expect(gap.status).toBe('gap')
    expect(gap.summary).toContain("can't re-run CI (Actions: Read and write)")
  })

  it('a fine-grained token never reads as ok: writes cannot be proven without writing', () => {
    const g = line({ source: 'pat_fine_grained', abilities: { contents: 'read_only', pullRequests: 'read_only', actions: 'read_only', secrets: 'read_only' } })
    expect(g.status).toBe('unknown')
    expect(g.summary).toContain('it never writes to check')
  })

  it("Mushi's fallback token is labelled as Mushi's, never the owner's", () => {
    expect(line({ source: 'platform' }).summary).toContain("Mushi's own fallback token (not yours)")
  })

  it('no token, no repo and an unreadable probe each get a line', () => {
    expect(line({ source: 'none', abilities: null }).status).toBe('gap')
    expect(noRepoGap(P).status).toBe('gap')
    const u = line({ abilities: null, readError: 'GitHub did not answer' })
    expect(u.status).toBe('unknown')
    expect(u.summary).toContain('GitHub did not answer')
  })
})

describe('deployGap: the 14-day rule (report 9f64a77b)', () => {
  it('never seen, 14 days and older are gaps; 13 days is fine; a failed read is unknown', () => {
    expect(deployGap(P, null, NOW).status).toBe('gap')
    expect(deployGap(P, daysAgo(DEPLOY_SILENCE_DAYS), NOW)).toMatchObject({ status: 'gap', summary: expect.stringContaining('No deploy seen in 14 days') })
    expect(deployGap(P, daysAgo(13.9), NOW)).toMatchObject({ status: 'ok', summary: 'Last deploy seen 13 days ago.' })
    expect(deployGap(P, daysAgo(0.2), NOW).summary).toBe('A deploy was seen today.')
    expect(deployGap(P, undefined, NOW).status).toBe('unknown')
  })
})

describe('followupKeyGap', () => {
  it('Mushi turned follow-ups off because the key was deleted: a gap with the reason', () => {
    const g = followupKeyGap({ projectId: P, settings: { enabled: false, offReason: 'The Cursor key was deleted.', keyId: null } })
    expect(g).toMatchObject({ status: 'gap', fixHref: '/settings?tab=byok#review-followups' })
    expect(g.summary).toContain('The Cursor key was deleted.')
  })

  it('on with a deleted or disabled key is a gap; off by choice and on with an active key are fine', () => {
    const s = { enabled: true, offReason: null, keyId: 'k1' }
    expect(followupKeyGap({ projectId: P, settings: s, keyStatus: null }).status).toBe('gap')
    expect(followupKeyGap({ projectId: P, settings: s, keyStatus: 'quota_exhausted' }).summary).toContain('quota exhausted')
    expect(followupKeyGap({ projectId: P, settings: s, keyStatus: 'active' }).status).toBe('ok')
    expect(followupKeyGap({ projectId: P, settings: { enabled: false, offReason: null, keyId: null } }).status).toBe('ok')
    expect(followupKeyGap({ projectId: P, settings: null }).status).toBe('unknown')
  })
})

describe('autofixKeyGap', () => {
  it('auto-fix on with no key that can dispatch is a gap; off or with a key is fine', () => {
    expect(autofixKeyGap({ projectId: P, dispatcher: { autofixOn: true, server: { agentKeys: 0, offKeys: 2 } } })).toMatchObject({
      status: 'gap',
      summary: expect.stringContaining('2 keys are off'),
      fixHref: '/credits#cursor-fix-bugs',
    })
    expect(autofixKeyGap({ projectId: P, dispatcher: { autofixOn: true, server: { agentKeys: 1, offKeys: 0 } } }).status).toBe('ok')
    expect(autofixKeyGap({ projectId: P, dispatcher: { autofixOn: false, server: { agentKeys: 0, offKeys: 0 } } }).status).toBe('ok')
    expect(autofixKeyGap({ projectId: P, dispatcher: null }).status).toBe('unknown')
  })
})

describe('slackGap', () => {
  const row = (status: string, message: string | null, at = daysAgo(0.01)) => ({ status, message, checked_at: at })
  it('Slack rejecting the token is a gap; a stale or other failure is unknown, not ok', () => {
    expect(slackGap({ projectId: P, connected: true, latest: row('down', 'Slack auth.test error: invalid_auth') }, NOW)).toMatchObject({ status: 'gap', summary: expect.stringContaining('invalid_auth') })
    expect(slackGap({ projectId: P, connected: true, latest: row('down', 'TypeError: fetch failed') }, NOW).status).toBe('unknown')
    expect(slackGap({ projectId: P, connected: true, latest: row('ok', null, daysAgo(2)) }, NOW).status).toBe('unknown')
    expect(slackGap({ projectId: P, connected: true, latest: null }, NOW).status).toBe('unknown')
    expect(slackGap({ projectId: P, connected: true, latest: row('ok', 'Connected') }, NOW).status).toBe('ok')
    expect(slackGap({ projectId: P, connected: false, latest: null }, NOW).status).toBe('ok')
  })
})

describe('platform checks', () => {
  it('names only what is missing, never a value, and is audience platform with no app', () => {
    const env: Record<string, string> = { SLACK_CLIENT_ID: 'x', SLACK_SIGNING_SECRET: 'y', LINEAR_OAUTH_CLIENT_ID: 'a', LINEAR_OAUTH_CLIENT_SECRET: 'b' }
    const gaps = platformGaps((n) => !!env[n])
    const slack = gaps.find((g) => g.id === 'platform_slack_oauth')!
    expect(slack).toMatchObject({ status: 'gap', audience: 'platform', projectId: null, missing: ['SLACK_CLIENT_SECRET'] })
    expect(slack.summary).toBe('SLACK_CLIENT_SECRET is not set on the server, so "Add to Slack" for every app fails.')
    expect(gaps.find((g) => g.id === 'platform_linear_oauth')!.status).toBe('ok')
    expect(JSON.stringify(gaps)).not.toMatch(/"x"|"y"|"a"|"b"/)
  })
})

describe('lists', () => {
  const g = (id: string, status: SetupGap['status'], audience: SetupGap['audience'] = 'app_owner'): SetupGap => ({ id, projectId: null, audience, status, title: id, summary: id, fixHref: '/' })

  it('an app page never gets platform lines', () => {
    const all = [g('a', 'gap'), g('platform_slack_oauth', 'gap', 'platform'), g('b', 'ok')]
    expect(forAudience(all, 'app_owner').map((x) => x.id)).toEqual(['a', 'b'])
    expect(forAudience(all, 'platform').map((x) => x.id)).toEqual(['platform_slack_oauth'])
  })

  it('sorts gaps, then unknown, then ok, stable within each; counts each', () => {
    const list = [g('ok1', 'ok'), g('u1', 'unknown'), g('gap1', 'gap'), g('ok2', 'ok'), g('gap2', 'gap')]
    expect(sortGaps(list).map((x) => x.id)).toEqual(['gap1', 'gap2', 'u1', 'ok1', 'ok2'])
    expect(countByStatus(list)).toEqual({ ok: 2, gap: 2, unknown: 1 })
  })
})

describe('createTtlCache', () => {
  it('keeps an entry for 10 minutes, then forgets it; evicts the oldest past the cap', () => {
    const c = createTtlCache<number>(SETUP_GAPS_CACHE_MS, 2)
    c.set('a', 1, 0)
    expect(c.get('a', SETUP_GAPS_CACHE_MS - 1)?.value).toBe(1)
    expect(c.get('a', SETUP_GAPS_CACHE_MS)).toBeNull()
    c.set('a', 1, 0)
    c.set('b', 2, 0)
    c.set('c', 3, 0)
    expect(c.get('a', 1)).toBeNull()
    expect(c.get('c', 1)?.value).toBe(3)
  })
})
