/**
 * Plan 018 — release publish reaches reporters, and credits are stamped only
 * after delivery. Until 2026-10 publish stamped every release credit as
 * "notified" without sending anything (the repo's silent fail-open shape).
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/email.ts', () => ({ sendTransactionalEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../supabase/functions/_shared/web-push.ts', () => ({ getVapidConfig: () => null, sendWebPushToSubscription: vi.fn() }))
vi.mock('../../supabase/functions/_shared/reputation.ts', () => ({ awardPoints: vi.fn(async () => ({})) }))
vi.mock('../../supabase/functions/_shared/report-transition.ts', () => ({ runStatusTransitionSideEffects: vi.fn() }))

type Release = typeof import('../../supabase/functions/_shared/release-reporters.ts')
let rel: Release

beforeAll(async () => {
  rel = await import('../../supabase/functions/_shared/release-reporters.ts')
})

const PROJECT = 'p1'
const RELEASE = { id: 'aaaaaaaa-0000-4000-8000-000000000001', project_id: PROJECT, version: '1.4.0' }

function db(reports: Row[], mode: 'auto' | 'review' = 'auto', extra: Record<string, Row[]> = {}): FakeDb {
  return makeFakeDb(
    {
      project_settings: [{ project_id: PROJECT, reporter_updates_mode: mode }],
      reports,
      release_credits: reports.map((r, i) => ({ id: `cr${i}`, release_id: RELEASE.id, report_id: r.id, notified_at: null })),
      ...extra,
    },
    { autoId: true, strictSingle: true, uniques: { notification_deliveries: ['report_id', 'notification_type', 'channel', 'dedupe_key'] } },
  )
}

const ids = (...r: Row[]) => r.map((x) => x.id as string)

describe('notifyReleaseReporters + stampDeliveredReleaseCredits', () => {
  it('resolves, versions and notifies each listed report once; stamps only delivered credits', async () => {
    const open = { id: 'r1', project_id: PROJECT, status: 'fixing', reporter_token_hash: 'rk1_a' }
    const noReporter = { id: 'r2', project_id: PROJECT, status: 'classified', reporter_token_hash: null }
    const fake = db([open, noReporter])
    const res = await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ids(open, noReporter, open) }, 'u1')
    expect(res).toMatchObject({ ok: true, delivery: { reports_resolved: 2, reporters_notified: 1, reports_without_reporter: 1 } })
    expect(fake.table('reports').find((r) => r.id === 'r1')).toMatchObject({ status: 'fixed', fixed_in_version: '1.4.0', fixed_release_id: RELEASE.id })
    expect(fake.table('reporter_notifications')).toHaveLength(1)
    expect(fake.table('reporter_notifications')[0]).toMatchObject({ notification_type: 'released', dedupe_key: RELEASE.id })

    const stamp = await rel.stampDeliveredReleaseCredits(fake as never, RELEASE.id)
    expect(stamp).toEqual({ ok: true, stamped: 1, pending: 1 })
    const credits = fake.table('release_credits')
    expect(credits.find((c) => c.report_id === 'r1')?.notified_at).toBeTruthy()
    expect(credits.find((c) => c.report_id === 'r2')?.notified_at).toBeNull()

    // Publishing again (retry) sends nothing new.
    await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ids(open) }, 'u1')
    expect(fake.table('reporter_notifications')).toHaveLength(1)
  })

  it('does not stamp a credit whose message is held for review', async () => {
    const open = { id: 'r1', project_id: PROJECT, status: 'fixed', reporter_token_hash: 'rk1_a' }
    const fake = db([open], 'review')
    const res = await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ids(open) }, 'u1')
    expect(res).toMatchObject({ ok: true, delivery: { reporters_held: 1, reporters_notified: 0 } })
    expect(await rel.stampDeliveredReleaseCredits(fake as never, RELEASE.id)).toEqual({ ok: true, stamped: 0, pending: 1 })
    expect(fake.table('release_credits')[0].notified_at).toBeNull()
  })

  it('never resurrects a dismissed report, and does not re-ask a verified one', async () => {
    const dismissed = { id: 'r1', project_id: PROJECT, status: 'dismissed', reporter_token_hash: 'rk1_a' }
    const verified = { id: 'r2', project_id: PROJECT, status: 'verified', reporter_token_hash: 'rk1_b' }
    const fake = db([dismissed, verified])
    const res = await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ids(dismissed, verified) }, 'u1')
    expect(res).toMatchObject({ ok: true, delivery: { reports_skipped_dismissed: 1, reports_resolved: 1 } })
    expect(fake.table('reports').find((r) => r.id === 'r1')).toMatchObject({ status: 'dismissed' })
    expect(fake.table('reports').find((r) => r.id === 'r2')).toMatchObject({ status: 'verified', fixed_in_version: '1.4.0' })
    expect(fake.table('reporter_notifications')).toHaveLength(0)
  })

  it('ignores report ids from another project', async () => {
    const foreign = { id: 'r9', project_id: 'other', status: 'fixing', reporter_token_hash: 'rk1_x' }
    const fake = db([foreign])
    const res = await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ['r9'] }, 'u1')
    expect(res).toMatchObject({ ok: true, delivery: { reports_not_found: 1, reports_resolved: 0 } })
    expect(fake.table('reports')[0]).toMatchObject({ status: 'fixing' })
  })

  it('stamps nothing and reports the error when the ledger can not be read', async () => {
    const open = { id: 'r1', project_id: PROJECT, status: 'fixing', reporter_token_hash: 'rk1_a' }
    const fake = db([open])
    await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ids(open) }, 'u1')
    const orig = fake.from.bind(fake)
    const failing = {
      select: () => failing,
      eq: () => failing,
      in: () => failing,
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'ledger down' } }).then(ok),
    }
    ;(fake as unknown as { from: (t: string) => unknown }).from = (t: string) => (t === 'notification_deliveries' ? failing : orig(t))
    const res = await rel.stampDeliveredReleaseCredits(fake as never, RELEASE.id)
    expect(res).toMatchObject({ ok: false })
    expect(fake.table('release_credits')[0].notified_at).toBeNull()
  })
})

describe('publishRelease (shared by manual publish and auto-release)', () => {
  it('publishes a draft, messages its reporter, stamps the credit, and names the actor', async () => {
    const { publishRelease } = await import('../../supabase/functions/_shared/release-publish.ts')
    const { runStatusTransitionSideEffects } = await import('../../supabase/functions/_shared/report-transition.ts')
    const open = { id: 'r1', project_id: PROJECT, status: 'fixing', reporter_token_hash: 'rk1_a' }
    const fake = db([open], 'auto', {
      releases: [{ ...RELEASE, status: 'draft', published_at: null, fixed_report_ids: ['r1'], fulfilled_ticket_ids: [] }],
    })
    const res = await publishRelease(fake as never, RELEASE.id, { kind: 'system', id: 'auto-release:github_release' })
    expect(res).toMatchObject({ ok: true, notified: 1, ticketsFulfilled: 0, delivery: { reporters_notified: 1, credits_stamped: 1 } })
    expect(fake.table('releases')[0]).toMatchObject({ status: 'published' })
    expect(fake.table('reports')[0]).toMatchObject({ status: 'fixed', fixed_release_id: RELEASE.id })
    expect(runStatusTransitionSideEffects).toHaveBeenCalledWith(
      fake,
      expect.objectContaining({ actor: { kind: 'system', id: 'auto-release:github_release' }, notifyReporter: false }),
    )

    // Publishing again is a 404, not a second round of messages.
    const again = await publishRelease(fake as never, RELEASE.id, { kind: 'admin', id: 'u1' })
    expect(again).toEqual({ ok: false, status: 404, error: 'Release not found or already published' })
    expect(fake.table('reporter_notifications')).toHaveLength(1)
  })

  it('a console user id still reaches the transition side effects as an admin actor', async () => {
    const { runStatusTransitionSideEffects } = await import('../../supabase/functions/_shared/report-transition.ts')
    const open = { id: 'r5', project_id: PROJECT, status: 'fixing', reporter_token_hash: null }
    const fake = db([open])
    await rel.notifyReleaseReporters(fake as never, { ...RELEASE, fixed_report_ids: ['r5'] }, 'u42')
    expect(runStatusTransitionSideEffects).toHaveBeenCalledWith(
      fake,
      expect.objectContaining({ reportId: 'r5', actor: { kind: 'admin', id: 'u42' } }),
    )
  })
})

describe('release-builder draft', () => {
  it('never lists a report an earlier release already shipped (its reporter would hear "shipped" twice)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/release-builder/index.ts'),
      'utf8',
    )
    const query = src.slice(src.indexOf(".from('reports')"), src.indexOf('.limit(50)'))
    expect(query).toContain(".eq('status', 'fixed')")
    expect(query).toContain(".is('fixed_release_id', null)")
  })
})
