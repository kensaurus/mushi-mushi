/**
 * FILE: ops-events.test.ts
 * PURPOSE: Recording and delivering Ops events (docs/execplans/ops-hub-slack.md
 *          §1, §3) on the in-memory fake database, with Slack stubbed:
 *            - dedupe: a repeated dedupe_key stores once;
 *            - threads: a follow-up replies under the first event of its thread
 *              in the same category; a resolve is broadcast and edits the parent;
 *            - a muted app is stored, not posted; no bot token falls back to the
 *              category's incoming webhook; a Slack error is recorded, never thrown;
 *            - Mushi Mushi's own sources: only for orgs with the bot on, PII
 *              redacted, and a resolve only posts while its thread is open;
 *            - Acknowledge: once, ✅ and a "Seen by" reply.
 *          Also the sources' builders (deployments, Sentry, edge canaries).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})

const { ackOpsEvent, deliverOpsEvent, emitOpsEvent, recordOpsEvent } = await import('../../supabase/functions/_shared/ops-events.ts')
const { opsEventFromCanary, opsEventFromSentry, opsEventsFromDeploymentStatus } = await import('../../supabase/functions/_shared/ops-sources.ts')
const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW = new Date('2026-11-17T05:00:00Z')

function settings(over: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    enabled: true,
    team_id: 'T0123',
    bot_user_id: 'U0BOT',
    bot_token_secret_id: 'vault-bot',
    signing_secret_id: 'vault-sign',
    payments_webhook_secret_id: null,
    releases_webhook_secret_id: null,
    alerts_webhook_secret_id: null,
    channel_payments: 'C0PAY',
    channel_releases: 'C0REL',
    channel_alerts: 'C0ALR',
    command: '/kensaurus',
    icon_base_url: null,
    ...over,
  }
}

const VAULT: Record<string, string> = { 'vault-bot': 'xoxb-test-token', 'vault-hook': 'https://hooks.slack.com/services/T/B/x' } // check-no-secrets: ignore-line — literal fixtures, not credentials

function setup(seed: Record<string, Record<string, unknown>[]> = {}) {
  const db = makeFakeDb(
    {
      projects: [{ id: P1, organization_id: ORG, name: 'Glot.it', slug: 'glot-it', icon_url: 'https://cdn.test/glot.png' }],
      ops_slack_settings: [settings()],
      ...seed,
    },
    {
      autoId: true,
      partialUniques: { ops_events: { keys: ['organization_id', 'dedupe_key'], where: (r) => r.dedupe_key != null } },
      rpc: (fn, args) => (fn === 'vault_get_secret' ? (VAULT[String(args.secret_id)] ?? null) : null),
    },
  )
  const calls: Array<{ url: string; body: Record<string, any> }> = []
  let tsSeq = 100
  const slackReplies: Record<string, (body: Record<string, any>) => Record<string, unknown>> = {}
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ url: String(url), body })
    const method = String(url).split('/').pop() ?? ''
    if (String(url).startsWith('https://hooks.slack.com/')) return new Response('ok', { status: 200 })
    const custom = slackReplies[method]
    return new Response(JSON.stringify(custom ? custom(body) : { ok: true, ts: `${tsSeq++}.0001`, channel: body.channel }), { status: 200 })
  }) as unknown as typeof fetch
  const deps = { fetchImpl, now: () => NOW, adminBaseUrl: 'https://kensaur.us/mushi-mushi/admin', sleep: async () => {} }
  return { db, calls, deps, slackReplies }
}

const event = (over: Record<string, unknown> = {}) => ({ category: 'alerts' as const, severity: 'urgent' as const, kind: 'deploy.failed', title: 'Production deploy failed', ...over })

describe('recordOpsEvent', () => {
  it('stores once per dedupe key', async () => {
    const { db, deps } = setup()
    const a = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ dedupeKey: 'gh:1' }) }, deps)
    const b = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ dedupeKey: 'gh:1' }) }, deps)
    expect(a.status).toBe('created')
    expect(b.status).toBe('duplicate')
    expect(b.status !== 'error' && a.status !== 'error' && b.event.id).toBe(a.status !== 'error' && a.event.id)
    expect(db.table('ops_events')).toHaveLength(1)
  })

  it('links a follow-up to the first event of its thread in the same category only', async () => {
    const { db, deps } = setup()
    const first = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ threadKey: 'deploy:o/r:production' }) }, deps)
    const releases = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ category: 'releases', severity: 'info', threadKey: 'deploy:o/r:production' }) }, deps)
    const resolved = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ severity: 'resolved', threadKey: 'deploy:o/r:production' }) }, deps)
    if (first.status !== 'created' || releases.status !== 'created' || resolved.status !== 'created') throw new Error('not created')
    expect(releases.event.parent_id).toBeNull()
    expect(resolved.event.parent_id).toBe(first.event.id)
  })
})

describe('threads follow the open incident, not the first one ever', () => {
  it('fail → resolve → fail starts a second root, and the second resolve edits the second root', async () => {
    const { db, calls, deps } = setup()
    const at = (m: number) => new Date(Date.parse('2026-11-17T00:00:00Z') + m * 60_000).toISOString()
    const post = async (over: Record<string, unknown>) => {
      const r = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ threadKey: 'uptime:https://a.test', ...over }) }, deps)
      if (r.status !== 'created') throw new Error('x')
      await deliverOpsEvent(db as never, r.event, deps)
      return db.table('ops_events').find((e) => e.id === r.event.id)!
    }
    const fail1 = await post({ occurredAt: at(0) })
    const fix1 = await post({ severity: 'resolved', title: 'Back up', occurredAt: at(10) })
    const fail2 = await post({ occurredAt: at(60) })
    const fix2 = await post({ severity: 'resolved', title: 'Back up again', occurredAt: at(70) })
    expect(fix1.parent_id).toBe(fail1.id)
    expect(fail2.parent_id).toBeNull()
    expect(fix2.parent_id).toBe(fail2.id)
    const updates = calls.filter((c) => c.url.endsWith('chat.update')).map((c) => c.body.ts)
    expect(updates).toEqual([fail1.slack_ts, fail2.slack_ts])
    expect(fail1.slack_ts).not.toBe(fail2.slack_ts)
  })

  it('a follow-up that is not a resolve replies under the open incident’s root', async () => {
    const { db, deps } = setup()
    const root = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ threadKey: 'inv:1', occurredAt: '2026-11-17T01:00:00.000Z' }) }, deps)
    const warn = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ severity: 'warn', threadKey: 'inv:1', occurredAt: '2026-11-17T02:00:00.000Z' }) }, deps)
    const again = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ severity: 'warn', threadKey: 'inv:1', occurredAt: '2026-11-17T03:00:00.000Z' }) }, deps)
    if (root.status !== 'created' || warn.status !== 'created' || again.status !== 'created') throw new Error('x')
    expect(warn.event.parent_id).toBe(root.event.id)
    expect(again.event.parent_id).toBe(root.event.id)
  })

  it('two production deploys are two release messages, not a thread', () => {
    const one = opsEventsFromDeploymentStatus({ deployment_status: { id: 1, state: 'success', environment: 'production' }, deployment: { sha: 'a'.repeat(40), production_environment: true }, repository: { full_name: 'o/r' } })
    expect(one[0]).toMatchObject({ category: 'releases', threadKey: null })
  })
})

describe('deliverOpsEvent', () => {
  it('posts with the bot, keeps the ts, and threads a resolve under its parent (broadcast + parent edit)', async () => {
    const { db, calls, deps } = setup()
    const first = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ threadKey: 't1' }) }, deps)
    if (first.status !== 'created') throw new Error('x')
    expect(await deliverOpsEvent(db as never, first.event, deps)).toMatchObject({ delivered: true, via: 'bot' })
    const stored = db.table('ops_events')[0]
    expect(stored).toMatchObject({ slack_channel: 'C0ALR', slack_ts: '100.0001', slack_error: null })
    expect(calls[0].body).toMatchObject({ channel: 'C0ALR', text: 'glot.it · Production deploy failed' })
    expect(calls[0].body.thread_ts).toBeUndefined()

    const fix = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ severity: 'resolved', title: 'Fixed by the next deploy', threadKey: 't1' }) }, deps)
    if (fix.status !== 'created') throw new Error('x')
    await deliverOpsEvent(db as never, fix.event, deps)
    const post = calls.find((c) => c.url.endsWith('chat.postMessage') && c.body.thread_ts)
    expect(post?.body).toMatchObject({ thread_ts: '100.0001', reply_broadcast: true })
    const update = calls.find((c) => c.url.endsWith('chat.update'))
    expect(update?.body).toMatchObject({ channel: 'C0ALR', ts: '100.0001' })
    expect(JSON.stringify(update?.body.blocks)).toContain('✅ Fixed by the next deploy')
  })

  it('stores a muted app’s event without posting', async () => {
    const { db, calls, deps } = setup({ ops_mutes: [{ organization_id: ORG, project_id: P1, until: '2026-11-18T00:00:00Z' }] })
    const e = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event() }, deps)
    if (e.status !== 'created') throw new Error('x')
    expect(await deliverOpsEvent(db as never, e.event, deps)).toEqual({ delivered: false, reason: 'muted' })
    expect(calls).toHaveLength(0)
    expect(String(db.table('ops_events')[0].slack_error)).toContain('muted until')
  })

  it('falls back to the category’s incoming webhook without a bot token, with link buttons only', async () => {
    const { db, calls, deps } = setup({ ops_slack_settings: [settings({ bot_token_secret_id: null, alerts_webhook_secret_id: 'vault-hook' })] })
    const e = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ url: 'https://github.com/o/r/actions/runs/1' }) }, deps)
    if (e.status !== 'created') throw new Error('x')
    expect(await deliverOpsEvent(db as never, e.event, deps)).toEqual({ delivered: true, via: 'webhook' })
    expect(calls[0].url).toBe('https://hooks.slack.com/services/T/B/x')
    const actions = (calls[0].body.blocks as Array<{ type: string; elements?: Array<{ url?: string }> }>).find((b) => b.type === 'actions')
    expect(actions?.elements?.every((b) => typeof b.url === 'string')).toBe(true)
  })

  it('records a Slack error and never throws', async () => {
    const { db, deps, slackReplies } = setup()
    slackReplies['chat.postMessage'] = () => ({ ok: false, error: 'channel_not_found' })
    const e = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event() }, deps)
    if (e.status !== 'created') throw new Error('x')
    expect(await deliverOpsEvent(db as never, e.event, deps)).toMatchObject({ delivered: false, reason: 'failed', error: 'channel_not_found' })
    expect(db.table('ops_events')[0].slack_error).toBe('channel_not_found')
  })

  it('stores only when the team switched the bot off', async () => {
    const { db, calls, deps } = setup({ ops_slack_settings: [settings({ enabled: false })] })
    const e = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event() }, deps)
    if (e.status !== 'created') throw new Error('x')
    expect(await deliverOpsEvent(db as never, e.event, deps)).toEqual({ delivered: false, reason: 'slack_off' })
    expect(calls).toHaveLength(0)
  })

  it('retries once after a 429, then records ratelimited', async () => {
    const { db, deps } = setup()
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n++
      return new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
    }) as unknown as typeof fetch
    const sleep = vi.fn(async () => {})
    const e = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event() }, deps)
    if (e.status !== 'created') throw new Error('x')
    await deliverOpsEvent(db as never, e.event, { ...deps, fetchImpl, sleep })
    expect(n).toBe(2)
    expect(sleep).toHaveBeenCalledWith(3000)
    expect(db.table('ops_events')[0].slack_error).toBe('ratelimited')
  })
})

describe('emitOpsEvent (Mushi Mushi’s own sources)', () => {
  it('skips an org whose bot is off or unset', async () => {
    const { db, deps } = setup({ ops_slack_settings: [] })
    expect(await emitOpsEvent(db as never, { projectId: P1, input: event() }, deps)).toBe('skipped')
    expect(db.table('ops_events')).toHaveLength(0)
  })

  it('redacts PII instead of refusing', async () => {
    const { db, deps } = setup()
    expect(await emitOpsEvent(db as never, { projectId: P1, input: event({ title: 'TypeError for jane@example.com' }) }, deps)).toBe('created')
    expect(db.table('ops_events')[0].title).toBe('TypeError for @example.com')
  })

  it('posts a resolve only while its thread is open', async () => {
    const { db, deps } = setup()
    const up = event({ severity: 'resolved', title: 'Back up', threadKey: 'uptime:https://a.test', occurredAt: '2026-11-17T04:30:00.000Z' })
    expect(await emitOpsEvent(db as never, { projectId: P1, input: up, requireOpenThread: true }, deps)).toBe('skipped')
    await emitOpsEvent(db as never, { projectId: P1, input: event({ threadKey: 'uptime:https://a.test', dedupeKey: 'down:1', occurredAt: '2026-11-17T04:00:00.000Z' }) }, deps)
    expect(await emitOpsEvent(db as never, { projectId: P1, input: up, requireOpenThread: true }, deps)).toBe('created')
    expect(await emitOpsEvent(db as never, { projectId: P1, input: { ...up, dedupeKey: 'up:2', occurredAt: '2026-11-17T04:40:00.000Z' }, requireOpenThread: true }, deps)).toBe('skipped')
  })
})

describe('ackOpsEvent', () => {
  it('acknowledges once, adds ✅ and replies in the thread', async () => {
    const { db, calls, deps } = setup()
    const e = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event() }, deps)
    if (e.status !== 'created') throw new Error('x')
    await deliverOpsEvent(db as never, e.event, deps)
    const posted = db.table('ops_events')[0] as never
    expect(await ackOpsEvent(db as never, posted, { id: 'slack:U1', mention: '<@U1>' }, deps)).toEqual({ ok: true, already: false })
    expect(db.table('ops_events')[0]).toMatchObject({ acked_by: 'slack:U1' })
    expect(calls.some((c) => c.url.endsWith('reactions.add') && c.body.name === 'white_check_mark')).toBe(true)
    expect(calls.some((c) => c.url.endsWith('chat.postMessage') && c.body.text === 'Seen by <@U1>' && c.body.thread_ts === '100.0001')).toBe(true)
    expect(await ackOpsEvent(db as never, db.table('ops_events')[0] as never, { id: 'slack:U2', mention: '<@U2>' }, deps)).toEqual({ ok: true, already: true })
  })
})

describe('source builders', () => {
  const dep = (state: string, over: Record<string, unknown> = {}) => ({
    deployment_status: { id: 77, state, environment: 'production', target_url: 'https://github.com/o/r/actions/runs/9', created_at: '2026-11-17T04:00:00Z' },
    deployment: { id: 5, sha: 'abcdef1234567890', ref: 'main', environment: 'production', production_environment: true },
    repository: { full_name: 'o/r' },
    installation: { id: 1 },
    ...over,
  })

  it('a production deploy: success → release + a resolve for the alerts thread; failure → urgent alert', () => {
    const ok = opsEventsFromDeploymentStatus(dep('success'))
    expect(ok.map((e) => [e.category, e.severity, e.dedupeKey])).toEqual([
      ['releases', 'info', 'gh-deploy-status:77'],
      ['alerts', 'resolved', 'gh-deploy-status:77:resolved'],
    ])
    expect(ok[0]).toMatchObject({ title: 'Deployed abcdef1', threadKey: null, source: 'github' })
    expect(ok[1]).toMatchObject({ threadKey: 'deploy:o/r:production' })
    const bad = opsEventsFromDeploymentStatus(dep('failure'))
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ category: 'alerts', severity: 'urgent', kind: 'deploy.failed', threadKey: 'deploy:o/r:production' })
  })

  it('ignores previews, staging and in-flight states', () => {
    expect(opsEventsFromDeploymentStatus(dep('in_progress'))).toEqual([])
    expect(opsEventsFromDeploymentStatus(dep('success', { deployment: { sha: 'abcdef1', environment: 'preview', production_environment: false }, deployment_status: { id: 1, state: 'success', environment: 'preview' } }))).toEqual([])
  })

  it('Sentry: new production errors and regressions go to alerts; warnings and staging do not', () => {
    expect(opsEventFromSentry({ outcome: 'created', issueId: '42', title: 'TypeError: x', level: 'error', environment: 'production', firstSeen: '2026-11-17T00:00:00Z' })).toMatchObject({ category: 'alerts', severity: 'warn', threadKey: 'sentry:42', dedupeKey: 'sentry:42:2026-11-17T00:00:00Z' })
    expect(opsEventFromSentry({ outcome: 'created', issueId: '42', title: 'x', level: 'fatal' })).toMatchObject({ severity: 'urgent' })
    expect(opsEventFromSentry({ outcome: 'reopened', issueId: '42', title: 'x', level: 'error', regressionCount: 2 })).toMatchObject({ severity: 'urgent', title: 'Came back: x', dedupeKey: 'sentry:42:regression:2' })
    expect(opsEventFromSentry({ outcome: 'created', issueId: '42', title: 'x', level: 'warning' })).toBeNull()
    expect(opsEventFromSentry({ outcome: 'created', issueId: '42', title: 'x', level: 'error', environment: 'staging' })).toBeNull()
    expect(opsEventFromSentry({ outcome: 'resolved', issueId: '42', title: null })).toMatchObject({ severity: 'resolved', threadKey: 'sentry:42' })
  })

  it('edge canaries: down is urgent, up resolves the same thread', () => {
    const t = { projectId: P1, canaryId: 'k1', label: 'Home page', url: 'https://glot.it/', detail: 'Expected 200, got 503', failingSince: '2026-11-17T03:00:00Z' }
    expect(opsEventFromCanary({ ...t, state: 'down' })).toMatchObject({ severity: 'urgent', title: 'Home page is down', threadKey: 'uptime:https://glot.it/', dedupeKey: 'uptime:k1:down:2026-11-17T03:00:00Z' })
    expect(opsEventFromCanary({ ...t, state: 'up' })).toMatchObject({ severity: 'resolved', threadKey: 'uptime:https://glot.it/' })
  })
})

describe('cross-org', () => {
  it('an event is threaded only within its own org', async () => {
    const { db, deps } = setup()
    await recordOpsEvent(db as never, { organizationId: OTHER_ORG, projectId: null, input: event({ threadKey: 'shared' }) }, deps)
    const mine = await recordOpsEvent(db as never, { organizationId: ORG, projectId: P1, input: event({ severity: 'resolved', threadKey: 'shared' }) }, deps)
    expect(mine.status === 'created' && mine.event.parent_id).toBeNull()
  })
})
