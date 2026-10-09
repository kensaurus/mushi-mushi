/**
 * Plan 018 — reporter notifications, delivery ledger and Outbox.
 *
 * Every guard here is exercised on its failure path, because this repo has
 * shipped the silent fail-open shape repeatedly (a guard errors, a non-fatal
 * branch swallows it, the feature "works" behind a 200 and does nothing):
 * - keyed ledger rows on one (report, type, channel) must each deliver; an
 *   unfiltered conflict lookup would error on the second and skip it;
 * - a review-mode read error must HOLD the message, not send it;
 * - a release / fan-out may stamp in_app `sent` only after the row exists;
 * - a follower's row must not collide with the owner's.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/email.ts', () => ({
  sendTransactionalEmail: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../supabase/functions/_shared/web-push.ts', () => ({
  getVapidConfig: () => null,
  sendWebPushToSubscription: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/reputation.ts', () => ({
  awardPoints: vi.fn(async () => ({})),
}))

type Notifications = typeof import('../../supabase/functions/_shared/notifications.ts')
type Fanout = typeof import('../../supabase/functions/_shared/reporter-fanout.ts')
type StatusNotify = typeof import('../../supabase/functions/_shared/report-status-notify.ts')
let n: Notifications
let fanout: Fanout
let statusNotify: StatusNotify

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = 'p1'
const REPORT = 'r1'
const OWNER = 'rk1_owner'
const FOLLOWER = 'rk1_follower'

beforeAll(async () => {
  n = await import('../../supabase/functions/_shared/notifications.ts')
  fanout = await import('../../supabase/functions/_shared/reporter-fanout.ts')
  statusNotify = await import('../../supabase/functions/_shared/report-status-notify.ts')
})

function db(seed: Record<string, Row[]> = {}): FakeDb {
  return makeFakeDb(
    { project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'auto' }], ...seed },
    {
      autoId: true,
      strictSingle: true,
      // notification_deliveries: unique (report, type, channel, coalesce(dedupe_key, ''))
      uniques: { notification_deliveries: ['report_id', 'notification_type', 'channel', 'dedupe_key'] },
    },
  )
}

/** A `from()` that fails for one table, like a PostgREST error. */
function failingTable(fake: FakeDb, table: string): FakeDb {
  const orig = fake.from.bind(fake)
  const failing = {
    select: () => failing,
    eq: () => failing,
    maybeSingle: () => failing,
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'relation exploded' } }).then(ok),
  }
  ;(fake as unknown as { from: (t: string) => unknown }).from = (t: string) => (t === table ? failing : orig(t))
  return fake
}

const payload = { message: 'm', reportId: REPORT }

describe('createNotification', () => {
  it('delivers in-app and stamps the ledger after the insert', async () => {
    const fake = db()
    const res = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload)
    expect(res).toMatchObject({ held: false, delivered: ['in_app'], failed: [] })
    expect(fake.table('reporter_notifications')).toHaveLength(1)
    expect(fake.table('notification_deliveries')[0]).toMatchObject({ channel: 'in_app', status: 'sent' })
  })

  it('is idempotent per (report, type, channel) without a key', async () => {
    const fake = db()
    await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload)
    const again = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload)
    expect(again.duplicate).toEqual(['in_app'])
    expect(fake.table('reporter_notifications')).toHaveLength(1)
  })

  it('delivers every keyed row on one (report, type, channel) — the conflict lookup filters on the key', async () => {
    const fake = db()
    const a = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'released', payload, { dedupeKey: 'rel-1' })
    const b = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'released', payload, { dedupeKey: 'rel-2' })
    expect(a.delivered).toEqual(['in_app'])
    expect(b.delivered).toEqual(['in_app'])
    // Re-running the second one is a no-op, not an error (strictSingle would
    // raise PGRST116 if the lookup ignored dedupe_key).
    const b2 = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'released', payload, { dedupeKey: 'rel-2' })
    expect(b2).toMatchObject({ duplicate: ['in_app'], failed: [] })
    expect(fake.table('reporter_notifications')).toHaveLength(2)
  })

  it('never stores category or severity', async () => {
    const fake = db()
    await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'classified', {
      message: n.buildNotificationMessage('classified', { category: 'bug', severity: 'high' }),
      category: 'bug',
      severity: 'high',
      reportId: REPORT,
    })
    const row = fake.table('reporter_notifications')[0]
    expect(row.payload).not.toHaveProperty('category')
    expect(row.payload).not.toHaveProperty('severity')
    expect(JSON.stringify(row.payload)).not.toMatch(/bug\/high|high/)
  })

  it('keeps low-value types in-app only even when email and push are on', async () => {
    const fake = db({
      reporter_notification_prefs: [
        { project_id: PROJECT, reporter_token_hash: OWNER, channels: { in_app: true, email: true, push: true }, notification_email: 'a@b.c' },
      ],
    })
    const res = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'duplicate_linked', payload)
    expect(res.delivered).toEqual(['in_app'])
    expect(fake.table('notification_deliveries').map((d) => d.channel)).toEqual(['in_app'])
  })

  it('holds a reviewable message in review mode — nothing is sent, no ledger row', async () => {
    const fake = db({ project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'review' }] })
    const res = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload, { reviewable: true })
    expect(res.held).toBe(true)
    expect(fake.table('reporter_notifications')[0]).toMatchObject({ status: 'held' })
    expect(fake.table('notification_deliveries')).toHaveLength(0)
  })

  it('never holds a non-reviewable message (direct replies, the reporter’s own actions)', async () => {
    const fake = db({ project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'review' }] })
    const res = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'verified', payload)
    expect(res).toMatchObject({ held: false, delivered: ['in_app'] })
  })

  it('fails CLOSED when the review-mode setting can not be read: the message is held, not sent', async () => {
    const fake = failingTable(db(), 'project_settings')
    const res = await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload, { reviewable: true })
    expect(res.held).toBe(true)
    expect(fake.table('notification_deliveries')).toHaveLength(0)
  })
})

describe('followers', () => {
  it('owner and follower both get a row on the canonical report', async () => {
    const fake = db({
      reporter_report_follows: [{ report_id: REPORT, project_id: PROJECT, reporter_token_hash: FOLLOWER, source_report_id: 'r2' }],
    })
    await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload)
    const followers = await n.notifyFollowers(fake as never, PROJECT, REPORT, 'fixed', payload)
    expect(followers).toHaveLength(1)
    expect(followers[0].delivered).toEqual(['in_app'])
    const rows = fake.table('reporter_notifications')
    expect(rows.map((r) => r.reporter_token_hash).sort()).toEqual([FOLLOWER, OWNER])
    expect(rows.find((r) => r.reporter_token_hash === FOLLOWER)?.dedupe_key).toBe(n.followerDedupeKey(FOLLOWER, null))
  })
})

describe('status transitions', () => {
  const follow = { report_id: REPORT, project_id: PROJECT, reporter_token_hash: FOLLOWER, source_report_id: 'r2' }

  it('followers get a plain fix_started, never the owner’s points', async () => {
    const fake = db({ reporter_report_follows: [follow] })
    await statusNotify.notifyReportStatusTransition(fake as never, {
      projectId: PROJECT,
      reportId: REPORT,
      reporterTokenHash: OWNER,
      previousStatus: 'classified',
      newStatus: 'fixing',
    })
    const rows = fake.table('reporter_notifications')
    const owner = rows.find((r) => r.reporter_token_hash === OWNER)
    const follower = rows.find((r) => r.reporter_token_hash === FOLLOWER)
    expect(owner).toMatchObject({ notification_type: 'confirmed' })
    expect(follower).toMatchObject({ notification_type: 'fix_started' })
    expect(follower?.payload).not.toHaveProperty('points')
  })

  it('a spam close sends nothing at all', async () => {
    const fake = db({ reporter_report_follows: [follow] })
    await statusNotify.notifyReportStatusTransition(fake as never, {
      projectId: PROJECT,
      reportId: REPORT,
      reporterTokenHash: OWNER,
      previousStatus: 'classified',
      newStatus: 'dismissed',
      closedReason: 'spam',
    })
    expect(fake.table('reporter_notifications')).toHaveLength(0)
  })

  describe('duplicate close — exactly one notice', () => {
    const CANONICAL = 'r-canonical'
    const grouped = {
      reports: [{ id: REPORT, project_id: PROJECT, report_group_id: 'g1' }],
      report_groups: [{ id: 'g1', canonical_report_id: CANONICAL }],
    }
    const close = (fake: FakeDb) =>
      statusNotify.notifyReportStatusTransition(fake as never, {
        projectId: PROJECT,
        reportId: REPORT,
        reporterTokenHash: OWNER,
        previousStatus: 'classified',
        newStatus: 'dismissed',
        closedReason: 'duplicate',
      })
    // reporter_notifications: unique (report_id, notification_type, dedupe_key) where dedupe_key is not null
    const dbWithNotifUnique = (seed: Record<string, Row[]>) =>
      makeFakeDb(
        { project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'auto' }], ...seed },
        {
          autoId: true,
          strictSingle: true,
          uniques: {
            notification_deliveries: ['report_id', 'notification_type', 'channel', 'dedupe_key'],
            reporter_notifications: ['report_id', 'notification_type', 'dedupe_key'],
          },
        },
      )

    it('closed without prior grouping notice: one duplicate_linked, keyed by the canonical id, nothing for followers', async () => {
      const fake = dbWithNotifUnique({ ...grouped, reporter_report_follows: [follow] })
      await close(fake)
      const rows = fake.table('reporter_notifications')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        reporter_token_hash: OWNER,
        notification_type: 'duplicate_linked',
        dedupe_key: CANONICAL,
      })
      expect(rows[0].payload).toMatchObject({ canonicalReportId: CANONICAL })
      expect(fake.table('notification_deliveries')[0]).toMatchObject({ channel: 'in_app', status: 'sent', dedupe_key: CANONICAL })
    })

    it('grouped first (the trigger already wrote the notice), then closed: still one row', async () => {
      const fake = dbWithNotifUnique({
        ...grouped,
        reporter_notifications: [
          { id: 'trig', report_id: REPORT, reporter_token_hash: OWNER, notification_type: 'duplicate_linked', status: 'sent', dedupe_key: CANONICAL, payload: {} },
        ],
      })
      await close(fake)
      expect(fake.table('reporter_notifications')).toHaveLength(1)
      expect(fake.table('reporter_notifications').some((r) => r.notification_type === 'dismissed')).toBe(false)
    })

    it('closing again is a no-op', async () => {
      const fake = dbWithNotifUnique(grouped)
      await close(fake)
      await close(fake)
      expect(fake.table('reporter_notifications')).toHaveLength(1)
    })
  })

  it('holds pipeline messages in review mode', async () => {
    const fake = db({ project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'review' }] })
    await statusNotify.notifyReportStatusTransition(fake as never, {
      projectId: PROJECT,
      reportId: REPORT,
      reporterTokenHash: OWNER,
      previousStatus: 'fixing',
      newStatus: 'fixed',
    })
    expect(fake.table('reporter_notifications')[0]).toMatchObject({ notification_type: 'fixed', status: 'held' })
  })
})

describe('Outbox', () => {
  it('release flips held → sent once, then stamps the in-app ledger', async () => {
    const fake = db({ project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'review' }] })
    await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'fixed', payload, { reviewable: true })
    const id = fake.table('reporter_notifications')[0].id as string

    const first = await n.releaseHeldNotification(fake as never, { notificationId: id, projectId: PROJECT, releasedBy: 'u1', bodyOverride: 'Fixed for you!' })
    expect(first.ok && first.result.delivered).toEqual(['in_app'])
    expect(fake.table('reporter_notifications')[0]).toMatchObject({ status: 'sent', body_override: 'Fixed for you!', released_by: 'u1' })
    expect(fake.table('notification_deliveries')[0]).toMatchObject({ channel: 'in_app', status: 'sent' })

    const second = await n.releaseHeldNotification(fake as never, { notificationId: id, projectId: PROJECT, releasedBy: 'u1' })
    expect(second).toMatchObject({ ok: false, code: 'NOT_HELD' })
  })

  it('discard hides it for good; another project can not touch it', async () => {
    const fake = db({ project_settings: [{ project_id: PROJECT, reporter_updates_mode: 'review' }] })
    await n.createNotification(fake as never, PROJECT, REPORT, OWNER, 'dismissed', payload, { reviewable: true })
    const id = fake.table('reporter_notifications')[0].id as string
    expect(await n.discardHeldNotification(fake as never, { notificationId: id, projectId: 'other', discardedBy: null })).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await n.discardHeldNotification(fake as never, { notificationId: id, projectId: PROJECT, discardedBy: null })).toMatchObject({ ok: true })
    expect(fake.table('reporter_notifications')[0].status).toBe('discarded')
  })
})

describe('reporter-notify-fanout', () => {
  // PostgREST coerces the string id for the bigint column; the fake compares strictly.
  const comment = { id: '42', report_id: REPORT, project_id: PROJECT, author_kind: 'admin', visible_to_reporter: true }
  const report = { id: REPORT, project_id: PROJECT, reporter_token_hash: OWNER }

  it('stamps in_app sent only because the trigger row exists, and never inserts a second row', async () => {
    const fake = db({
      report_comments: [comment],
      reports: [report],
      reporter_notifications: [
        { id: 'n1', report_id: REPORT, reporter_token_hash: OWNER, notification_type: 'comment_reply', status: 'sent', dedupe_key: '42', payload: { message: 'hi' } },
      ],
    })
    const out = await fanout.fanOutCommentNotification(fake as never, '42')
    expect(out).toMatchObject({ ok: true, type: 'comment_reply' })
    expect(fake.table('reporter_notifications')).toHaveLength(1)
    expect(fake.table('notification_deliveries')[0]).toMatchObject({ channel: 'in_app', status: 'sent', dedupe_key: '42' })
  })

  it('reports IN_APP_ROW_MISSING instead of stamping a delivery that did not happen', async () => {
    const fake = db({ report_comments: [comment], reports: [report] })
    const out = await fanout.fanOutCommentNotification(fake as never, '42')
    expect(out).toMatchObject({ ok: false, code: 'IN_APP_ROW_MISSING' })
    expect(fake.table('notification_deliveries')).toHaveLength(0)
  })

  it('skips internal notes and token-less reports', async () => {
    const internal = db({ report_comments: [{ ...comment, visible_to_reporter: false }], reports: [report] })
    expect(await fanout.fanOutCommentNotification(internal as never, '42')).toMatchObject({ ok: true, skipped: 'not_reporter_visible' })
    const tokenless = db({ report_comments: [comment], reports: [{ ...report, reporter_token_hash: null }] })
    expect(await fanout.fanOutCommentNotification(tokenless as never, '42')).toMatchObject({ ok: true, skipped: 'no_reporter' })
  })

  it('rejects a malformed trigger body', () => {
    expect(fanout.parseFanoutBody({ comment_id: 7 })).toEqual({ commentId: '7' })
    expect(fanout.parseFanoutBody({ comment_id: '7' })).toEqual({ commentId: '7' })
    expect(fanout.parseFanoutBody({ comment_id: '7; drop' })).toBeNull()
    expect(fanout.parseFanoutBody(null)).toBeNull()
  })
})

describe('DB contract', () => {
  const migrations = resolve(HERE, '../../supabase/migrations')
  const v2 = readFileSync(resolve(migrations, '20261002120100_reporter_notifications_v2.sql'), 'utf8')
  const trigger = readFileSync(resolve(migrations, '20261002120200_reporter_comments_fanout_v2.sql'), 'utf8')
  const checkBlock = v2.split('reporter_notifications_type_check')[2] ?? ''
  const allowed = new Set([...checkBlock.split(');')[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))

  it('the type CHECK allows every type createNotification can write', () => {
    for (const type of n.NOTIFICATION_TYPES) expect(allowed, type).toContain(type)
  })

  it('the type CHECK allows every type the SQL triggers write', () => {
    for (const type of ['comment_reply', 'info_requested', 'duplicate_linked']) {
      expect(trigger).toContain(`'${type}'`)
      expect(allowed, type).toContain(type)
    }
  })

  it('keeps every type production already holds', () => {
    // From prod (2026-10-02): reporter_notifications has classified, confirmed, points_awarded.
    for (const type of ['classified', 'confirmed', 'points_awarded']) expect(allowed).toContain(type)
  })

  it('the trigger never lets a fan-out failure roll back the reply', () => {
    expect(trigger).toMatch(/perform mushi\.edge_function_post\([\s\S]*?exception when others then\s+raise warning/)
  })
})
