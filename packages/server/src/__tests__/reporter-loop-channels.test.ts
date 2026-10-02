/**
 * Plan 018 Phase 3 — opt-in channels: email double opt-in, one-click
 * unsubscribe, reporter Web Push, frequency caps, the daily digest, and
 * per-project templates.
 *
 * Fail-open guard (this repo has shipped it four times): an email that can
 * not go out must say why in the ledger (`skipped` + reason, or `deferred`),
 * never read as `sent`, and never vanish without a row.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase'

const email = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(async (_m: { to: string; subject: string; text?: string; headers?: Record<string, string> }) => ({ ok: true as const, id: 'em_1' })),
}))
const push = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(async () => ({ ok: true as const, status: 201 })),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/email.ts', () => ({
  emailProviderConfigured: () => email.configured,
  sendTransactionalEmail: email.send,
}))
vi.mock('../../supabase/functions/_shared/web-push.ts', () => ({
  getVapidConfig: () => (push.configured ? { publicKey: 'BPub', privateKey: 'priv', subject: 'mailto:x@y.z' } : null),
  sendWebPushToSubscription: push.send,
  isAllowedPushEndpoint: (raw: string) => {
    try {
      const u = new URL(raw)
      return u.protocol === 'https:' && (u.hostname === 'fcm.googleapis.com' || u.hostname.endsWith('.push.services.mozilla.com'))
    } catch {
      return false
    }
  },
}))
vi.mock('../../supabase/functions/_shared/reputation.ts', () => ({ awardPoints: vi.fn(async () => ({})) }))

type Notifications = typeof import('../../supabase/functions/_shared/notifications.ts')
type Digest = typeof import('../../supabase/functions/_shared/reporter-digest.ts')
type Optin = typeof import('../../supabase/functions/_shared/reporter-optin.ts')
type EmailPolicy = typeof import('../../supabase/functions/_shared/reporter-email.ts')
type Copy = typeof import('../../supabase/functions/_shared/reporter-copy.ts')
type Settings = typeof import('../../supabase/functions/_shared/reporter-settings.ts')
let n: Notifications
let digest: Digest
let optin: Optin
let policy: EmailPolicy
let copy: Copy
let settingsMod: Settings

beforeAll(async () => {
  n = await import('../../supabase/functions/_shared/notifications.ts')
  digest = await import('../../supabase/functions/_shared/reporter-digest.ts')
  optin = await import('../../supabase/functions/_shared/reporter-optin.ts')
  policy = await import('../../supabase/functions/_shared/reporter-email.ts')
  copy = await import('../../supabase/functions/_shared/reporter-copy.ts')
  settingsMod = await import('../../supabase/functions/_shared/reporter-settings.ts')
})

beforeEach(() => {
  email.configured = true
  email.send.mockClear()
  email.send.mockImplementation(async () => ({ ok: true as const, id: 'em_1' }))
  push.configured = true
  push.send.mockClear()
})

const PROJECT = 'p1'
const OWNER = 'rk1_owner'
const ADDRESS = 'reporter@example.com'

function settings(over: Row = {}): Row {
  return {
    project_id: PROJECT,
    reporter_updates_mode: 'auto',
    reporter_email_enabled: true,
    reporter_push_enabled: true,
    reporter_templates: {},
    ...over,
  }
}

function verifiedPrefs(over: Row = {}): Row {
  return {
    project_id: PROJECT,
    reporter_token_hash: OWNER,
    channels: { in_app: true, email: true, push: true },
    notification_email: ADDRESS,
    email_verified_at: '2026-10-01T00:00:00.000Z',
    unsubscribed_at: null,
    unsubscribe_token: 'u'.repeat(43),
    ...over,
  }
}

function db(seed: Record<string, Row[]> = {}): FakeDb {
  return makeFakeDb(
    {
      project_settings: [settings()],
      projects: [{ id: PROJECT, name: 'Acme Notes' }],
      reports: ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id, project_id: PROJECT, title: `Report ${id}` })),
      reporter_push_subscriptions: [
        { id: 's1', project_id: PROJECT, reporter_token_hash: OWNER, endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'k', auth: 'a' },
      ],
      ...seed,
    },
    {
      autoId: true,
      strictSingle: true,
      uniques: {
        notification_deliveries: ['report_id', 'notification_type', 'channel', 'dedupe_key'],
        reporter_notification_prefs: ['project_id', 'reporter_token_hash'],
      },
    },
  )
}

const ledger = (fake: FakeDb, channel: string) => fake.table('notification_deliveries').filter((d) => d.channel === channel)

describe('email: every non-send says why in the ledger', () => {
  const fire = (fake: FakeDb) =>
    n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'Can you try again?', reportId: 'r1' }, { dedupeKey: 'c1' })

  it('provider unset → skipped "not_configured", never sent or failed, nothing attempted', async () => {
    email.configured = false
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    const res = await fire(fake)
    expect(res.skipped).toContain('email')
    expect(res.delivered).not.toContain('email')
    expect(res.failed).not.toContain('email')
    expect(ledger(fake, 'email')).toEqual([expect.objectContaining({ status: 'skipped', error_message: 'not_configured' })])
    expect(email.send).not.toHaveBeenCalled()
  })

  it('the provider vanishing at send time is still not_configured, not failed', async () => {
    email.send.mockImplementationOnce(async () => ({ ok: false, reason: 'no_api_key', error: 'RESEND_API_KEY not configured' }) as never)
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await fire(fake)
    expect(ledger(fake, 'email')[0]).toMatchObject({ status: 'skipped', error_message: 'not_configured' })
  })

  it.each([
    ['project gate off', { project_settings: [settings({ reporter_email_enabled: false })], reporter_notification_prefs: [verifiedPrefs()] }, 'project_disabled'],
    ['address never confirmed', { reporter_notification_prefs: [verifiedPrefs({ email_verified_at: null })] }, 'unverified'],
    ['reporter unsubscribed', { reporter_notification_prefs: [verifiedPrefs({ unsubscribed_at: '2026-10-02T00:00:00Z' })] }, 'unsubscribed'],
  ])('%s → skipped "%s"', async (_label, seed, reason) => {
    const fake = db(seed as Record<string, Row[]>)
    await fire(fake)
    expect(ledger(fake, 'email')[0]).toMatchObject({ status: 'skipped', error_message: reason })
    expect(email.send).not.toHaveBeenCalled()
  })

  it('a reporter who never opted in gets no email row at all', async () => {
    const fake = db()
    await fire(fake)
    expect(ledger(fake, 'email')).toHaveLength(0)
  })

  it('a sent email names the host app and carries RFC 8058 one-click headers', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    const res = await fire(fake)
    expect(res.delivered).toContain('email')
    const mail = email.send.mock.calls[0][0]
    expect(mail.to).toBe(ADDRESS)
    expect(mail.subject).toMatch(/^Acme Notes: /)
    expect(mail.subject).not.toMatch(/mushi/i)
    expect(mail.text).toContain('Can you try again?')
    expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<.*\/v1\/public\/reporter\/email\/unsubscribe\?t=u{43}>$/)
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})

describe('frequency caps — 5 events in one day', () => {
  it('email ≤3/day (rest deferred), push ≤2/day (rest skipped "capped"), each event in-app', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    const events: Array<[string, 'comment_reply' | 'info_requested' | 'released' | 'fixed']> = [
      ['r1', 'comment_reply'],
      ['r2', 'comment_reply'],
      ['r3', 'info_requested'],
      ['r4', 'released'],
      ['r5', 'fixed'],
    ]
    for (const [reportId, type] of events) {
      await n.createNotification(fake as never, PROJECT, reportId, OWNER, type, { message: `update on ${reportId}`, reportId, version: '1.4' }, { dedupeKey: `k-${reportId}` })
    }

    expect(ledger(fake, 'in_app').filter((d) => d.status === 'sent')).toHaveLength(5)

    const mail = ledger(fake, 'email')
    expect(mail.filter((d) => d.status === 'sent').map((d) => d.report_id)).toEqual(['r1', 'r2', 'r3'])
    expect(mail.filter((d) => d.status === 'deferred')).toEqual([
      expect.objectContaining({ report_id: 'r4', error_message: 'capped_daily' }),
      expect.objectContaining({ report_id: 'r5', error_message: 'capped_daily' }),
    ])
    expect(email.send).toHaveBeenCalledTimes(3)

    const pushes = ledger(fake, 'push')
    expect(pushes.filter((d) => d.status === 'sent')).toHaveLength(2)
    expect(pushes.filter((d) => d.status === 'skipped' && d.error_message === 'capped')).toHaveLength(3)
    expect(push.send).toHaveBeenCalledTimes(2)
  })

  it('at most one email per report per day — the second is deferred "capped_report"', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'one', reportId: 'r1' }, { dedupeKey: 'c1' })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'two', reportId: 'r1' }, { dedupeKey: 'c2' })
    expect(ledger(fake, 'email').map((d) => [d.status, d.error_message ?? null])).toEqual([
      ['sent', null],
      ['deferred', 'capped_report'],
    ])
  })

  it('a re-run of a deferred delivery does not send it early', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'one', reportId: 'r1' }, { dedupeKey: 'c1' })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'two', reportId: 'r1' }, { dedupeKey: 'c2' })
    const again = await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'two', reportId: 'r1' }, { dedupeKey: 'c2' })
    expect(again.duplicate).toContain('email')
    expect(email.send).toHaveBeenCalledTimes(1)
  })

  it('low-value pipeline events never reach email or push', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    for (const type of ['reviewing', 'fix_started', 'duplicate_linked'] as const) {
      await n.createNotification(fake as never, PROJECT, 'r1', OWNER, type, { message: '', reportId: 'r1' })
    }
    expect(ledger(fake, 'email')).toHaveLength(0)
    expect(ledger(fake, 'push')).toHaveLength(0)
  })

  it('push never carries verified / reopened / closed (lock-screen worthy events only)', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs({ channels: { in_app: true, email: false, push: true } })] })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'verified', { message: '', reportId: 'r1' })
    await n.createNotification(fake as never, PROJECT, 'r2', OWNER, 'dismissed', { message: '', reportId: 'r2' })
    expect(ledger(fake, 'push')).toHaveLength(0)
  })

  it('push with the project gate off → skipped "project_disabled"', async () => {
    const fake = db({
      project_settings: [settings({ reporter_push_enabled: false })],
      reporter_notification_prefs: [verifiedPrefs({ channels: { in_app: true, email: false, push: true } })],
    })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'fixed', { message: '', reportId: 'r1' })
    expect(ledger(fake, 'push')[0]).toMatchObject({ status: 'skipped', error_message: 'project_disabled' })
    expect(push.send).not.toHaveBeenCalled()
  })
})

describe('daily digest', () => {
  async function capped(fake: FakeDb) {
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      await n.createNotification(fake as never, PROJECT, id, OWNER, 'comment_reply', { message: `reply on ${id}`, reportId: id }, { dedupeKey: `k-${id}` })
    }
    email.send.mockClear()
  }

  it('sends ONE email covering every deferred row and flips them to sent; a second run sends nothing', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await capped(fake)
    const run = await digest.sendReporterDigests(fake as never)
    expect(run).toMatchObject({ not_configured: false, reporters: 1, emails_sent: 1, rows_sent: 2 })
    expect(email.send).toHaveBeenCalledTimes(1)
    const mail = email.send.mock.calls[0][0]
    expect(mail.subject).toBe('Acme Notes: 2 updates on your reports')
    expect(mail.text).toContain('reply on r4')
    expect(mail.text).toContain('reply on r5')
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(ledger(fake, 'email').filter((d) => d.status === 'deferred')).toHaveLength(0)
    expect(ledger(fake, 'email').filter((d) => d.error_message === 'digest' && d.status === 'sent')).toHaveLength(2)

    email.send.mockClear()
    expect(await digest.sendReporterDigests(fake as never)).toMatchObject({ emails_sent: 0, rows_sent: 0 })
    expect(email.send).not.toHaveBeenCalled()
  })

  it('provider unset → reports not_configured and leaves every row deferred', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await capped(fake)
    email.configured = false
    expect(await digest.sendReporterDigests(fake as never)).toMatchObject({ not_configured: true, emails_sent: 0 })
    expect(ledger(fake, 'email').filter((d) => d.status === 'deferred')).toHaveLength(2)
  })

  it('a reporter who unsubscribed since gets nothing; the rows close as skipped with the reason', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await capped(fake)
    fake.table('reporter_notification_prefs')[0].unsubscribed_at = '2026-10-02T10:00:00Z'
    const run = await digest.sendReporterDigests(fake as never)
    expect(run.rows_skipped).toBe(2)
    expect(email.send).not.toHaveBeenCalled()
    expect(ledger(fake, 'email').filter((d) => d.error_message === 'digest_unsubscribed')).toHaveLength(2)
  })

  it('a failed send puts rows back to deferred for the next run', async () => {
    const fake = db({ reporter_notification_prefs: [verifiedPrefs()] })
    await capped(fake)
    email.send.mockImplementationOnce(async () => ({ ok: false, reason: 'http_error', error: 'Resend 500' }) as never)
    const run = await digest.sendReporterDigests(fake as never)
    expect(run.rows_retry).toBe(2)
    expect(ledger(fake, 'email').filter((d) => d.status === 'deferred')).toHaveLength(2)
  })
})

describe('double opt-in and one-click unsubscribe', () => {
  const tokenFrom = (url: string) => new URL(url).searchParams.get('t') as string

  it('opt in → confirm → updates arrive → unsubscribe link stops them', async () => {
    const fake = db()
    const put = await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: ' Reporter@Example.com ' })
    expect(put).toMatchObject({ ok: true, verification_sent: true })
    if (!put.ok) throw new Error('unreachable')
    expect(put.view).toMatchObject({ email: 're***@example.com', email_verified: false, email_pending: true })

    // Exactly one mail before confirmation: the verification mail.
    expect(email.send).toHaveBeenCalledTimes(1)
    const verifyMail = email.send.mock.calls[0][0]
    expect(verifyMail.to).toBe(ADDRESS)
    const confirmUrl = /https?:\/\/\S+|\/functions\/v1\/api\S+/.exec(verifyMail.text ?? '')?.[0] ?? ''
    expect(confirmUrl).toContain('/v1/public/reporter/email/verify?t=')
    const verifyToken = tokenFrom(`http://x${confirmUrl.slice(confirmUrl.indexOf('/functions'))}`)

    // The raw verify token is never stored.
    const row = fake.table('reporter_notification_prefs')[0]
    expect(row.email_verify_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(verifyToken)

    // Unconfirmed → no update mail.
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'fixed', { message: '', reportId: 'r1' })
    expect(ledger(fake, 'email')[0]).toMatchObject({ status: 'skipped', error_message: 'unverified' })

    expect(await optin.verifyReporterEmail(fake as never, verifyToken)).toMatchObject({ ok: true, appName: 'Acme Notes' })
    expect(await optin.verifyReporterEmail(fake as never, verifyToken)).toMatchObject({ ok: false, code: 'INVALID' })

    email.send.mockClear()
    await n.createNotification(fake as never, PROJECT, 'r2', OWNER, 'fixed', { message: '', reportId: 'r2' })
    expect(email.send).toHaveBeenCalledTimes(1)
    const header = email.send.mock.calls[0][0].headers?.['List-Unsubscribe'] ?? ''
    const unsubToken = tokenFrom(`http://x${header.slice(header.indexOf('/functions'), -1)}`)

    expect(await optin.unsubscribeReporterEmail(fake as never, unsubToken)).toMatchObject({ ok: true })
    // Idempotent: mail clients and people click twice.
    expect(await optin.unsubscribeReporterEmail(fake as never, unsubToken)).toMatchObject({ ok: true })
    expect(fake.table('reporter_notification_prefs')[0]).toMatchObject({ channels: expect.objectContaining({ email: false }) })

    email.send.mockClear()
    await n.createNotification(fake as never, PROJECT, 'r3', OWNER, 'fixed', { message: '', reportId: 'r3' })
    expect(email.send).not.toHaveBeenCalled()
  })

  it('refuses email when the server can not send it — nothing is stored as "on"', async () => {
    email.configured = false
    const fake = db()
    const put = await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: ADDRESS })
    expect(put).toMatchObject({ ok: false, status: 409, code: 'EMAIL_NOT_AVAILABLE', reason: 'not_configured' })
    expect(fake.table('reporter_notification_prefs')).toHaveLength(0)
    expect(email.send).not.toHaveBeenCalled()
  })

  it('refuses email when the project has it off', async () => {
    const fake = db({ project_settings: [settings({ reporter_email_enabled: false })] })
    expect(await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: ADDRESS })).toMatchObject({
      ok: false,
      code: 'EMAIL_NOT_AVAILABLE',
      reason: 'project_disabled',
    })
  })

  it('throttles confirmation mails to one a minute and rejects junk addresses', async () => {
    const fake = db()
    const now = new Date('2026-10-02T12:00:00Z')
    expect((await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: ADDRESS }, now)).ok).toBe(true)
    expect(await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: 'other@example.com' }, new Date(now.getTime() + 10_000))).toMatchObject({
      ok: false,
      status: 429,
    })
    expect(await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: 'not an email' }, new Date(now.getTime() + 120_000))).toMatchObject({
      ok: false,
      status: 422,
    })
  })

  it('an expired confirmation link does not verify', async () => {
    const fake = db()
    const sentAt = new Date('2026-09-01T00:00:00Z')
    await optin.updateReporterPrefs(fake as never, PROJECT, OWNER, { email: ADDRESS }, sentAt)
    const text = email.send.mock.calls[0][0].text ?? ''
    const t = /verify\?t=([A-Za-z0-9_-]+)/.exec(text)?.[1]
    expect(await optin.verifyReporterEmail(fake as never, t, new Date('2026-10-02T00:00:00Z'))).toMatchObject({ ok: false, code: 'EXPIRED' })
  })

  it('malformed tokens never reach the database', async () => {
    const fake = db()
    expect(await optin.unsubscribeReporterEmail(fake as never, "x' or 1=1")).toMatchObject({ ok: false, code: 'INVALID' })
    expect(await optin.verifyReporterEmail(fake as never, undefined)).toMatchObject({ ok: false, code: 'INVALID' })
  })
})

describe('reporter Web Push subscriptions', () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: 'BKey_-', auth: 'auth_-' } }

  it('stores an allow-listed endpoint and turns push on', async () => {
    const fake = db({ reporter_push_subscriptions: [] })
    expect(await optin.saveReporterPushSubscription(fake as never, PROJECT, OWNER, sub, 'UA')).toEqual({ ok: true })
    expect(fake.table('reporter_push_subscriptions')).toHaveLength(1)
    expect(fake.table('reporter_notification_prefs')[0]).toMatchObject({ channels: expect.objectContaining({ push: true }) })
  })

  it('rejects an endpoint outside the push-service allow-list (SSRF guard)', async () => {
    const fake = db({ reporter_push_subscriptions: [] })
    const res = await optin.saveReporterPushSubscription(fake as never, PROJECT, OWNER, { ...sub, endpoint: 'https://169.254.169.254/latest' }, null)
    expect(res).toMatchObject({ ok: false, status: 422 })
    expect(fake.table('reporter_push_subscriptions')).toHaveLength(0)
  })

  it('refuses when the project has push off or VAPID is unset', async () => {
    const off = db({ project_settings: [settings({ reporter_push_enabled: false })], reporter_push_subscriptions: [] })
    expect(await optin.saveReporterPushSubscription(off as never, PROJECT, OWNER, sub, null)).toMatchObject({ ok: false, status: 409, reason: 'project_disabled' })
    push.configured = false
    const unset = db({ reporter_push_subscriptions: [] })
    expect(await optin.saveReporterPushSubscription(unset as never, PROJECT, OWNER, sub, null)).toMatchObject({ ok: false, reason: 'not_configured' })
  })

  it('removing the last device turns push off', async () => {
    const fake = db({ reporter_push_subscriptions: [] })
    await optin.saveReporterPushSubscription(fake as never, PROJECT, OWNER, sub, null)
    expect(await optin.removeReporterPushSubscription(fake as never, PROJECT, OWNER, sub.endpoint)).toEqual({ ok: true, removed: 1 })
    expect(fake.table('reporter_notification_prefs')[0]).toMatchObject({ channels: expect.objectContaining({ push: false }) })
  })
})

describe('per-project templates', () => {
  it('rewords a pipeline message at write time; the widget, Outbox and email show the same words', async () => {
    const fake = db({
      project_settings: [settings({ reporter_templates: { released: 'Out now in {app} v{version} ({n} fixes).' } })],
    })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'released', { message: 'Shipped', reportId: 'r1', version: '2.1', fixedCount: 3 })
    const row = fake.table('reporter_notifications')[0]
    expect(row.payload).toMatchObject({ message: 'Out now in Acme Notes v2.1 (3 fixes).', templated: true })
    const safe = copy.reporterSafePayload(row as never)
    expect(safe).toMatchObject({ message: 'Out now in Acme Notes v2.1 (3 fixes).', custom: true })
  })

  it('never templates a developer reply', async () => {
    const fake = db({ project_settings: [settings({ reporter_templates: { fixed: 'Templated' } })] })
    await n.createNotification(fake as never, PROJECT, 'r1', OWNER, 'comment_reply', { message: 'my own words', reportId: 'r1' }, { dedupeKey: 'c1' })
    expect(fake.table('reporter_notifications')[0].payload).toMatchObject({ message: 'my own words' })
  })

  it('an untemplated legacy row still re-renders from the fixed copy', () => {
    const safe = copy.reporterSafePayload({ id: 'x', notification_type: 'classified', payload: { message: 'classified as bug/high' }, created_at: '' })
    expect(safe.message).toBe('The developer is looking into it')
    expect(safe).not.toHaveProperty('custom')
  })

  it('validates templates: known placeholders only, 280 chars, not empty', () => {
    expect(policy.templateError('Fixed in v{version} for {app}')).toBeNull()
    expect(policy.templateError('Hi {name}')).toMatch(/unknown placeholder \{name\}/)
    expect(policy.templateError('x'.repeat(281))).toMatch(/280/)
    expect(policy.templateError('   ')).toMatch(/empty/)
    expect(policy.sanitizeTemplates({ fixed: 'ok', bogus: 'no', released: '{evil}' })).toEqual({ fixed: 'ok' })
  })
})

describe('console settings update', () => {
  it('accepts mode, both gates and templates; empty template resets to the built-in wording', () => {
    expect(
      settingsMod.parseReporterSettingsUpdate({
        mode: 'review',
        email_enabled: true,
        push_enabled: false,
        templates: { fixed: '  Fixed in {app}!  ', released: '' },
      }),
    ).toEqual({
      ok: true,
      patch: {
        reporter_updates_mode: 'review',
        reporter_email_enabled: true,
        reporter_push_enabled: false,
        reporter_templates: { fixed: 'Fixed in {app}!' },
      },
    })
  })

  it('rejects unknown keys, bad placeholders and secrets', () => {
    expect(settingsMod.parseReporterSettingsUpdate({ mode: 'sometimes' })).toMatchObject({ ok: false, field: 'mode' })
    expect(settingsMod.parseReporterSettingsUpdate({ email_enabled: 'yes' })).toMatchObject({ ok: false, field: 'email_enabled' })
    expect(settingsMod.parseReporterSettingsUpdate({ templates: { comment_reply: 'x' } })).toMatchObject({ ok: false, field: 'templates.comment_reply' })
    expect(settingsMod.parseReporterSettingsUpdate({ templates: { fixed: 'Hi {user}' } })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(settingsMod.parseReporterSettingsUpdate({ templates: { fixed: 'key ghp_abcdefghijklmnopqrstuvwxyz0123' } })).toMatchObject({
      ok: false,
      code: 'SECRET_DETECTED',
    })
  })

  it('summarises the ledger by reason without leaking provider error text', () => {
    const out = settingsMod.summarizeDeliveries([
      { channel: 'email', status: 'skipped', error_message: 'not_configured' },
      { channel: 'email', status: 'skipped', error_message: 'not_configured' },
      { channel: 'email', status: 'failed', error_message: 'Resend 422: {"to":"secret@example.com"}' },
      { channel: 'push', status: 'skipped', error_message: 'capped' },
      { channel: 'email', status: 'sent', error_message: null },
      { channel: 'in_app', status: 'sent', error_message: null },
    ])
    expect(out[0]).toEqual({ channel: 'email', status: 'skipped', reason: 'not_configured', count: 2 })
    expect(out).toContainEqual({ channel: 'email', status: 'failed', reason: 'error', count: 1 })
    expect(out).toContainEqual({ channel: 'push', status: 'skipped', reason: 'capped', count: 1 })
    expect(JSON.stringify(out)).not.toContain('secret@example.com')
    expect(out.some((r) => (r.channel as string) === 'in_app')).toBe(false)
  })
})
