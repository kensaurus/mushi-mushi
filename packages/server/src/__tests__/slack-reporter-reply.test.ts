/**
 * Plan 018 §3 — "Reply to reporter" from the Slack card: the modal opens only
 * for a widget reporter, and a submit goes through the same reply path as the
 * console (one visible comment; the comment trigger handles in-app + email /
 * push with the reporter's opt-ins and caps).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase'

const token = vi.hoisted(() => ({ value: 'xoxb-test' as string | null }))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, audit: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/slack.ts', () => ({ resolveSlackBotToken: async () => token.value }))
vi.mock('../../supabase/functions/_shared/http.ts', () => ({ fetchWithTimeout: vi.fn() }))

type Mod = typeof import('../../supabase/functions/_shared/slack-reporter-reply.ts')
let m: Mod
beforeAll(async () => {
  m = await import('../../supabase/functions/_shared/slack-reporter-reply.ts')
})

const REPORT = '11111111-2222-4333-8444-555555555555'
const WIDGET_KEY = `rk1_${'b'.repeat(64)}`

function db(report: Row = {}) {
  return makeFakeDb(
    {
      reports: [{ id: REPORT, project_id: 'p1', title: 'Checkout button does nothing', reporter_token_hash: WIDGET_KEY, closed_reason: null, ...report }],
      projects: [{ id: 'p1', owner_id: 'owner-1' }],
    },
    { autoId: true },
  )
}

function submission(text: string | null, reportId = REPORT) {
  return {
    user: { id: 'U0CLICKER' },
    view: {
      callback_id: 'reply_reporter',
      private_metadata: reportId,
      state: { values: { reply: { message: { value: text } } } },
    },
  }
}

describe('openReporterReplyModal', () => {
  it('opens a modal carrying the report id, with the click trigger id and the bot token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    const res = await m.openReporterReplyModal(db() as never, { reportId: REPORT, triggerId: 'trig-1' }, fetchImpl as never)
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/views.open')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-test')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ trigger_id: 'trig-1', view: { callback_id: 'reply_reporter', private_metadata: REPORT } })
  })

  it('refuses when nobody could read the reply, or the report was closed as spam', async () => {
    const fetchImpl = vi.fn()
    expect(await m.openReporterReplyModal(db({ reporter_token_hash: 'sentry-webhook' }) as never, { reportId: REPORT, triggerId: 't' }, fetchImpl as never)).toMatchObject({ ok: false })
    expect(await m.openReporterReplyModal(db({ closed_reason: 'spam' }) as never, { reportId: REPORT, triggerId: 't' }, fetchImpl as never)).toMatchObject({ ok: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('says so when Slack has no bot token, instead of failing silently', async () => {
    token.value = null
    const res = await m.openReporterReplyModal(db() as never, { reportId: REPORT, triggerId: 't' }, vi.fn() as never)
    token.value = 'xoxb-test'
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining('console') })
  })
})

describe('submitSlackReporterReply', () => {
  it('posts ONE comment visible to the reporter and closes the modal', async () => {
    const fake = db()
    const out = await m.submitSlackReporterReply(fake as never, submission('  Fixed in 1.4 — can you try again?  '))
    expect(out).toEqual({ response_action: 'clear' })
    const comments = fake.table('report_comments')
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      report_id: REPORT,
      project_id: 'p1',
      author_kind: 'admin',
      author_user_id: 'owner-1',
      body: 'Fixed in 1.4 — can you try again?',
      visible_to_reporter: true,
    })
    // The trigger writes the in-app row; the helper must not write a second one.
    expect(fake.table('reporter_notifications')).toHaveLength(0)
  })

  it('records the Slack user who sent it in the audit log, not only the owner it is attributed to', async () => {
    const fake = db()
    await m.submitSlackReporterReply(fake as never, submission('Thanks!'))
    const audit = fake.table('audit_logs')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      project_id: 'p1',
      actor_id: 'owner-1',
      actor_type: 'slack',
      action: 'report.reporter_replied',
      resource_id: REPORT,
      metadata: { via: 'card_modal', slack_user_id: 'U0CLICKER', comment_id: fake.table('report_comments')[0].id },
    })
  })

  it('shows field errors in the modal for an empty, too long or stale submit', async () => {
    expect(await m.submitSlackReporterReply(db() as never, submission('   '))).toMatchObject({ response_action: 'errors' })
    expect(await m.submitSlackReporterReply(db() as never, submission('x'.repeat(2001)))).toMatchObject({ response_action: 'errors' })
    expect(await m.submitSlackReporterReply(db() as never, submission('hi', 'not-a-uuid'))).toMatchObject({ response_action: 'errors' })
    const spam = db({ closed_reason: 'spam' })
    expect(await m.submitSlackReporterReply(spam as never, submission('hi'))).toMatchObject({ response_action: 'errors' })
    expect(spam.table('report_comments')).toHaveLength(0)
  })
})
