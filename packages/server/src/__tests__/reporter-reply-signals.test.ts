/**
 * Plan 018 decision 10 — a reporter's reply is an admin signal.
 *
 * The reply must reach the people who can answer it: a threaded reply under
 * the report's Slack card, the `report.reporter_replied` plugin event, an
 * admin Web Push, and a `not_reproducible` close reopens. The comment
 * trigger (SQL) clears `awaiting_reporter_at`; a contract test pins that.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase'

const calls = vi.hoisted(() => ({
  slack: vi.fn(async (_o: { channel: string; text: string; threadTs: string | null }) => ({ ok: true })),
  plugin: vi.fn(async (_db: unknown, _p: string, _e: string, _d: unknown) => undefined),
  push: vi.fn(async (_db: unknown, _u: string, _m: unknown) => ({ sent: 1, failed: 0 }) as { sent: number; failed: number; error?: string }),
  transition: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/slack.ts', () => ({ sendBotMessage: calls.slack, sendSlackText: vi.fn() }))
vi.mock('../../supabase/functions/_shared/discord.ts', () => ({ sendDiscordNotification: vi.fn() }))
vi.mock('../../supabase/functions/_shared/teams.ts', () => ({ sendTeamsNotification: vi.fn() }))
vi.mock('../../supabase/functions/_shared/voice-return.ts', () => ({ notifyVoiceSessionsForReport: vi.fn() }))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({ dispatchPluginEventDetached: calls.plugin }))
vi.mock('../../supabase/functions/_shared/web-push.ts', () => ({ sendWebPushToUser: calls.push }))
vi.mock('../../supabase/functions/_shared/report-transition.ts', () => ({ runStatusTransitionSideEffects: calls.transition }))

type Signals = typeof import('../../supabase/functions/_shared/reporter-reply-signals.ts')
let signals: Signals

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } })
  signals = await import('../../supabase/functions/_shared/reporter-reply-signals.ts')
})

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockClear()
})

const PROJECT = 'p1'
const REPORT = 'r1'

function db(report: Row = {}, settings: Row = {}) {
  return makeFakeDb({
    project_settings: [{ project_id: PROJECT, slack_channel_id: 'C123', ...settings }],
    reports: [{ id: REPORT, project_id: PROJECT, summary: 'Checkout button does nothing', slack_message_ts: '1700000000.000100', status: 'classified', ...report }],
    projects: [{ id: PROJECT, name: 'Acme', owner_id: 'owner-1' }],
    project_members: [{ project_id: PROJECT, user_id: 'member-1' }],
  })
}

describe('announceReporterReply', () => {
  it('posts the reply as a threaded Slack message under the report card', async () => {
    await signals.announceReporterReply(db() as never, { projectId: PROJECT, reportId: REPORT, commentId: 7, body: 'Still broken on iOS 18' })
    expect(calls.slack).toHaveBeenCalledTimes(1)
    const msg = calls.slack.mock.calls[0][0]
    expect(msg).toMatchObject({ channel: 'C123', threadTs: '1700000000.000100' })
    expect(msg.text).toContain('Still broken on iOS 18')
  })

  it('fires the report.reporter_replied plugin event with a clipped excerpt', async () => {
    const long = 'x'.repeat(900)
    await signals.announceReporterReply(db() as never, { projectId: PROJECT, reportId: REPORT, commentId: 7, body: long })
    expect(calls.plugin).toHaveBeenCalledWith(expect.anything(), PROJECT, 'report.reporter_replied', expect.objectContaining({
      report: { id: REPORT },
      comment: expect.objectContaining({ id: 7, author_kind: 'reporter' }),
    }))
    const data = calls.plugin.mock.calls[0][3] as { comment: { body: string } }
    expect(data.comment.body.length).toBeLessThanOrEqual(500)
  })

  it('pushes to every console user of the project (members and owner)', async () => {
    await signals.announceReporterReply(db() as never, { projectId: PROJECT, reportId: REPORT, commentId: 7, body: 'hi' })
    expect(calls.push.mock.calls.map((c) => c[1]).sort()).toEqual(['member-1', 'owner-1'])
  })

  it('respects a project that turned the Slack reply notice off', async () => {
    await signals.announceReporterReply(db({}, { notification_prefs: { 'report.reporter_replied': false } }) as never, {
      projectId: PROJECT,
      reportId: REPORT,
      commentId: 7,
      body: 'hi',
    })
    expect(calls.slack).not.toHaveBeenCalled()
  })

  it('a reply to a "could not reproduce" close reopens the report', async () => {
    const fake = db({ status: 'dismissed', closed_reason: 'not_reproducible', reporter_token_hash: 'rk1_x' })
    await signals.announceReporterReply(fake as never, { projectId: PROJECT, reportId: REPORT, commentId: 7, body: 'It happened again' })
    expect(fake.table('reports')[0]).toMatchObject({ status: 'reopened', closed_reason: null })
    expect(calls.transition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ previousStatus: 'dismissed', newStatus: 'reopened' }))
  })

  it('leaves any other close alone', async () => {
    const fake = db({ status: 'dismissed', closed_reason: 'wont_fix' })
    await signals.announceReporterReply(fake as never, { projectId: PROJECT, reportId: REPORT, commentId: 7, body: 'please?' })
    expect(fake.table('reports')[0]).toMatchObject({ status: 'dismissed', closed_reason: 'wont_fix' })
  })
})

describe('comment trigger contract', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const sql = readFileSync(resolve(here, '../../supabase/migrations/20261002120200_reporter_comments_fanout_v2.sql'), 'utf8')

  it('a reporter reply stamps last_reporter_reply_at and clears awaiting_reporter_at', () => {
    const branch = sql.split("elsif NEW.author_kind = 'reporter' then")[1]?.split('end if;')[0] ?? ''
    expect(branch).toMatch(/last_reporter_reply_at\s*=\s*now\(\)/)
    expect(branch).toMatch(/awaiting_reporter_at\s*=\s*null/)
  })
})
