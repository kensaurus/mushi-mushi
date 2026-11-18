/**
 * FILE: ops-commands.test.ts
 * PURPOSE: The Ops hub's slash command answers (docs/execplans/ops-hub-slack.md
 *          §2), from stubbed data: status (worst first), sales by app and
 *          currency with refunds taken off, releases, open alerts (a resolved
 *          thread or an ack closes one), bugs with console links, CI today,
 *          apps with when each last reported, and mute / unmute.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})

const cmds = await import('../../supabase/functions/_shared/ops-commands.ts')
const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')

const NOW = new Date('2026-11-17T05:00:00Z')
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const apps = [
  { id: 'p1', name: 'Glot.it', slug: 'glot-it' },
  { id: 'p2', name: 'yen-yen', slug: 'yen-yen' },
]
const text = (r: { blocks?: unknown[]; text: string }) => JSON.stringify(r.blocks ?? r.text)

describe('answers', () => {
  it('status: worst first, with a shape for each state', () => {
    const r = cmds.answerStatus(
      [
        { app: apps[0], lastRelease: { title: 'v1.2.0', at: '2026-11-17T02:00:00Z' }, openAlerts: 0, urgentAlerts: 0, openBugs: 3, ciFailuresToday: 0, mutedUntil: null },
        { app: apps[1], lastRelease: null, openAlerts: 2, urgentAlerts: 1, openBugs: 1, ciFailuresToday: 4, mutedUntil: '2026-11-17T07:00:00Z' },
      ],
      NOW,
      'https://kensaur.us/admin',
    )
    const body = text(r)
    expect(body.indexOf('yen-yen')).toBeLessThan(body.indexOf('glot.it'))
    expect(body).toContain('🔴 *yen-yen*')
    expect(body).toContain('🟢 *glot.it*')
    expect(body).toContain('🚀 v1.2.0 · 3h ago')
    expect(body).toContain('✕ 4 CI failures today')
    expect(body).toContain('🔕 muted until 07:00 UTC')
    expect(r.response_type).toBe('ephemeral')
  })

  it('sales: by app and currency, refunds taken off, totals per currency', () => {
    const r = cmds.answerSales(
      [
        { project_id: 'p1', kind: 'payment.succeeded', amount_minor: 1000, currency: 'JPY' },
        { project_id: 'p1', kind: 'payment.succeeded', amount_minor: 2000, currency: 'JPY' },
        { project_id: 'p1', kind: 'refund.succeeded', amount_minor: 500, currency: 'JPY' },
        { project_id: 'p2', kind: 'payment.succeeded', amount_minor: 999, currency: 'USD' },
      ],
      apps,
      'week',
    )
    const body = text(r)
    expect(body).toContain('*glot.it*  ¥2,500  (2 payments, 1 refund)')
    expect(body).toContain('*yen-yen*  $9.99  (1 payment)')
    expect(r.text).toBe('Sales the last 7 days: ¥2,500, $9.99')
    expect(cmds.answerSales([], apps, 'today').text).toContain('No payments')
  })

  it('open alerts: an ack or a resolve in the thread closes one; urgent first', () => {
    const rows = [
      { id: '1', project_id: 'p1', category: 'alerts', severity: 'warn', kind: 'x', title: 'Slow API', url: null, occurred_at: '2026-11-17T04:00:00Z', thread_key: null, acked_at: null },
      { id: '2', project_id: 'p1', category: 'alerts', severity: 'urgent', kind: 'x', title: 'Site down', url: 'https://glot.it', occurred_at: '2026-11-17T03:00:00Z', thread_key: 'u1', acked_at: null },
      { id: '3', project_id: 'p2', category: 'alerts', severity: 'urgent', kind: 'x', title: 'Deploy failed', url: null, occurred_at: '2026-11-17T02:00:00Z', thread_key: 'd1', acked_at: null },
      { id: '4', project_id: 'p2', category: 'alerts', severity: 'resolved', kind: 'x', title: 'Fixed', url: null, occurred_at: '2026-11-17T02:30:00Z', thread_key: 'd1', acked_at: null },
      { id: '5', project_id: 'p2', category: 'alerts', severity: 'warn', kind: 'x', title: 'Seen', url: null, occurred_at: '2026-11-17T01:00:00Z', thread_key: null, acked_at: '2026-11-17T01:05:00Z' },
    ] as const
    expect(cmds.openAlerts(rows as never).map((a) => a.id)).toEqual(['1', '2'])
    // A second incident after the thread was resolved is open again.
    const again = [...rows, { id: '6', project_id: 'p2', category: 'alerts', severity: 'urgent', kind: 'x', title: 'Deploy failed again', url: null, occurred_at: '2026-11-17T04:30:00Z', thread_key: 'd1', acked_at: null }]
    expect(cmds.openAlerts(again as never).map((a) => a.id)).toEqual(['1', '2', '6'])
    const body = text(cmds.answerAlerts(rows as never, apps, NOW, null))
    expect(body.indexOf('Site down')).toBeLessThan(body.indexOf('Slow API'))
    expect(body).toContain('<https://glot.it|Site down>')
  })

  it("another app's resolve on the same thread key closes nothing (2026-11-18)", () => {
    const rows = [
      { id: 'a', project_id: 'p1', severity: 'urgent', thread_key: 'deploy:r:production', acked_at: null, occurred_at: '2026-11-18T01:00:00Z' },
      { id: 'b', project_id: 'p2', severity: 'resolved', thread_key: 'deploy:r:production', acked_at: null, occurred_at: '2026-11-18T02:00:00Z' },
    ]
    expect(cmds.openAlerts(rows as never).map((a) => a.id)).toEqual(['a'])
  })

  it('bugs: newest per app, linked to the console', () => {
    const r = cmds.answerBugs([{ id: 'abcdef12-0000-4000-8000-000000000000', project_id: 'p1', title: 'Checkout button dead', summary: null, severity: 'high', created_at: '2026-11-17T04:00:00Z' }], apps, NOW, 'https://kensaur.us/admin')
    expect(text(r)).toContain('<https://kensaur.us/admin/reports/abcdef12-0000-4000-8000-000000000000?project=p1|`abcdef12`>')
  })

  it('ci: failures first, the test machine’s stops named apart from code failures', () => {
    const r = cmds.answerCi(
      [
        { project_id: 'p1', ci_kind: 'passed' },
        { project_id: 'p2', ci_kind: 'code_failure' },
        { project_id: 'p2', ci_kind: 'runner_lost' },
      ],
      apps,
      null,
    )
    const body = text(r)
    expect(body.indexOf('yen-yen')).toBeLessThan(body.indexOf('glot.it'))
    expect(body).toContain('✕ 1 failed')
    expect(body).toContain('⛔ 1 stopped by the test machine')
  })

  it('apps: when each last reported, ○ for one that never sent an event', () => {
    const r = cmds.answerApps(apps, [{ project_id: 'p1', category: 'payments', last_at: '2026-11-17T03:00:00Z', count_7d: 4 }], [{ project_id: 'p2', until: '2026-11-17T09:00:00Z' }], NOW)
    const body = text(r)
    expect(body).toContain('● *glot.it*  💳 2h')
    expect(body).toContain('○ *yen-yen*')
    expect(body).toContain('🔕 until 09:00 UTC')
  })
})

describe('runOpsCommand on the database', () => {
  function db(seed: Record<string, Array<Record<string, unknown>>> = {}) {
    return makeFakeDb({ projects: apps.map((a) => ({ ...a, organization_id: ORG })), ...seed }, { autoId: true })
  }
  const ctx = { orgId: ORG, slackUserId: 'U1', command: '/kensaurus', consoleBase: null, now: NOW }

  it('mute and unmute an app by name', async () => {
    const d = db()
    const muted = await cmds.runOpsCommand(d as never, { sub: 'mute', app: 'glot', ms: 7_200_000, label: '2h' }, ctx)
    expect(muted.text).toContain('*glot.it* is muted here for 2h, until 07:00 UTC')
    expect(d.table('ops_mutes')[0]).toMatchObject({ organization_id: ORG, project_id: 'p1', muted_by: 'slack:U1' })
    const un = await cmds.runOpsCommand(d as never, { sub: 'unmute', app: 'glot.it' }, ctx)
    expect(un.text).toContain('posts here again')
    expect(d.table('ops_mutes')).toHaveLength(0)
    expect((await cmds.runOpsCommand(d as never, { sub: 'mute', app: 'nope', ms: 1, label: '1m' }, ctx)).text).toContain('No app called')
  })

  it('status reads this org only', async () => {
    const d = db({
      ops_events: [
        { organization_id: ORG, project_id: 'p1', category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: 'Deployed abc1234', occurred_at: '2026-11-17T04:00:00Z' },
        { organization_id: 'other', project_id: 'p9', category: 'alerts', severity: 'urgent', kind: 'x', title: 'Not ours', occurred_at: '2026-11-17T04:00:00Z' },
      ],
      reports: [{ id: 'r1', project_id: 'p2', status: 'new' }],
      ci_jobs: [{ project_id: 'p1', ci_kind: 'code_failure', gh_created_at: '2026-11-17T01:00:00Z' }],
    })
    const r = await cmds.runOpsCommand(d as never, { sub: 'status' }, ctx)
    const body = text(r)
    expect(body).toContain('Deployed abc1234')
    expect(body).not.toContain('Not ours')
    expect(body).toContain('🐞 1 open bug')
    expect(body).toContain('✕ 1 CI failure today')
  })
})
