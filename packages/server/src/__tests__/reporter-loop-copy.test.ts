/**
 * Plan 018 — what a reporter is shown, and the reply limiter.
 *
 * - Server English copy (`_shared/reporter-copy.ts`) is pinned to the SDK
 *   table in `@mushi-mushi/core/reporter-ui`, so the API's `text` and the
 *   widget's rendering of `kind` say the same thing.
 * - Stored payload text never reaches a reporter: the 18 historic
 *   "classified as bug/high" rows are re-rendered on read.
 * - The reply limiter calls `scoped_rate_limit_claim` with the deployed
 *   argument names and fails CLOSED on an unexpected error.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({ dispatchPluginEventDetached: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({ notifyTeamReporterReply: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/_shared/web-push.ts', () => ({ sendWebPushToUser: vi.fn(async () => ({ sent: 0, failed: 0 })) }))
vi.mock('../../supabase/functions/_shared/report-transition.ts', () => ({ runStatusTransitionSideEffects: vi.fn() }))

import { reporterCopy } from '../../../core/src/reporter-ui'

type Copy = typeof import('../../supabase/functions/_shared/reporter-copy.ts')
type Signals = typeof import('../../supabase/functions/_shared/reporter-reply-signals.ts')
let copy: Copy
let signals: Signals

beforeAll(async () => {
  copy = await import('../../supabase/functions/_shared/reporter-copy.ts')
  signals = await import('../../supabase/functions/_shared/reporter-reply-signals.ts')
})

describe('server copy matches the SDK table', () => {
  it('timeline and closed-reason strings equal core en', () => {
    const en = reporterCopy('en')
    expect(copy.REPORTER_COPY_EN.timeline).toEqual(en.timeline)
    expect(copy.REPORTER_COPY_EN.closedReason).toEqual(en.closedReason)
    expect(copy.REPORTER_COPY_EN.ui.developerReplied).toBe(en.ui.developerReplied)
  })
})

describe('reporterSafePayload', () => {
  const legacy = {
    id: 'n1',
    report_id: 'r1',
    notification_type: 'classified',
    payload: { message: 'Your report was classified as bug/high', category: 'bug', severity: 'high', reportId: 'r1' },
    created_at: '2026-10-01T00:00:00Z',
  }

  it('re-renders a historic classified row and drops category / severity', () => {
    const safe = copy.reporterSafePayload(legacy)
    expect(safe).toEqual({ reportId: 'r1', message: 'The developer is looking into it' })
  })

  it('passes developer replies and questions through verbatim', () => {
    for (const type of ['comment_reply', 'info_requested']) {
      expect(copy.reporterSafePayload({ ...legacy, notification_type: type, payload: { message: 'Which page?' } }).message).toBe('Which page?')
    }
  })

  it('uses an admin edit of a held message when one exists', () => {
    expect(copy.reporterSafePayload({ ...legacy, notification_type: 'fixed', body_override: 'Fixed on iOS too' }).message).toBe('Fixed on iOS too')
  })

  it('renders release versions and closed reasons from templates', () => {
    expect(copy.reporterSafePayload({ ...legacy, notification_type: 'released', payload: { version: '1.4.0', message: 'x' } }).message).toBe(
      'Shipped in v1.4.0 — update to get it',
    )
    expect(copy.reporterSafePayload({ ...legacy, notification_type: 'dismissed', payload: { closedReason: 'wont_fix', message: 'x' } }).message).toBe(
      'We decided not to change this.',
    )
  })
})

describe('buildReporterTimeline', () => {
  it('merges events and comments in order, renders questions as info_requested, drops reply rows', () => {
    const timeline = copy.buildReporterTimeline({
      reportCreatedAt: '2026-10-01T00:00:00Z',
      notifications: [
        { id: 'a', notification_type: 'classified', payload: { message: 'classified as bug/high' }, created_at: '2026-10-01T00:01:00Z' },
        { id: 'b', notification_type: 'info_requested', payload: { commentId: 7, message: 'Which page?' }, created_at: '2026-10-01T00:02:00Z' },
        { id: 'c', notification_type: 'comment_reply', payload: { commentId: 9, message: 'Thanks' }, created_at: '2026-10-01T00:04:00Z' },
        { id: 'd', notification_type: 'points_awarded', payload: { message: '+10' }, created_at: '2026-10-01T00:05:00Z' },
      ],
      comments: [
        { id: 7, author_kind: 'admin', body: 'Which page?', created_at: '2026-10-01T00:02:00Z' },
        { id: 8, author_kind: 'reporter', body: 'Settings', created_at: '2026-10-01T00:03:00Z' },
        { id: 9, author_kind: 'admin', body: 'Thanks', created_at: '2026-10-01T00:04:00Z' },
      ],
    })
    expect(timeline.map((t) => t.kind)).toEqual(['received', 'reviewing', 'info_requested', 'reporter_comment', 'comment'])
    expect(timeline[1].text).toBe('The developer is looking into it')
    expect(timeline[2].text).toBe('The developer asked: Which page?')
    expect(JSON.stringify(timeline)).not.toMatch(/bug\/high/)
  })
})

describe('groupBucket', () => {
  it('buckets, never echoes a number', () => {
    expect([0, 1, 2, 9, 10, 500].map(copy.groupBucket)).toEqual(['none', 'none', 'few', 'few', 'many', 'many'])
  })
})

describe('reporter reply limiter', () => {
  const DEPLOYED_ARGS = ['p_user_id', 'p_scope', 'p_max_per_window', 'p_window']

  function rpcDb(error: { message: string } | null) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    return {
      calls,
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return Promise.resolve({ error })
      },
    }
  }

  it('calls scoped_rate_limit_claim with the deployed argument names and a uuid actor', async () => {
    const db = rpcDb(null)
    expect(await signals.claimReporterReplySlot(db as never, 'p1', 'rk1_abc')).toEqual({ ok: true })
    expect(db.calls[0].fn).toBe('scoped_rate_limit_claim')
    expect(Object.keys(db.calls[0].args).sort()).toEqual([...DEPLOYED_ARGS].sort())
    expect(db.calls[0].args.p_user_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(db.calls[0].args).toMatchObject({ p_scope: 'reporter_reply', p_max_per_window: 10, p_window: '1 hour' })
  })

  it('keys the bucket per project and per reporter', async () => {
    const a = await signals.reporterReplyActorId('p1', 'rk1_a')
    expect(await signals.reporterReplyActorId('p1', 'rk1_a')).toBe(a)
    expect(await signals.reporterReplyActorId('p2', 'rk1_a')).not.toBe(a)
    expect(await signals.reporterReplyActorId('p1', 'rk1_b')).not.toBe(a)
  })

  it('reports the limit when exceeded', async () => {
    const res = await signals.claimReporterReplySlot(rpcDb({ message: 'rate_limit_exceeded' }) as never, 'p1', 'rk1_a')
    expect(res).toMatchObject({ ok: false, reason: 'limit' })
  })

  it('fails CLOSED on any other RPC error (e.g. a signature drift)', async () => {
    const res = await signals.claimReporterReplySlot(
      rpcDb({ message: 'Could not find the function public.scoped_rate_limit_claim in the schema cache' }) as never,
      'p1',
      'rk1_a',
    )
    expect(res).toMatchObject({ ok: false, reason: 'error' })
  })

  it('caps reporter replies at 2,000 characters', () => {
    expect(signals.REPORTER_REPLY_MAX_CHARS).toBe(2000)
  })
})
