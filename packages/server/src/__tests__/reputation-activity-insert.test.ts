/**
 * awardPointsForEndUser used to log PostgREST's raw gateway HTML with
 * rlog.error, which Sentry stored as the issue message on every
 * session_minute heartbeat. Transient gateway failures are a short status
 * line at warn (no Sentry). Heartbeats are not retried. Another award is
 * retried once only when the failure is known to precede the write (HTTP 503
 * or connection refused): a 502, a pooler error, or a connection reset can
 * arrive after commit, and end_user_activity has no idempotency key. Eight
 * transient failures in ten minutes inside one isolate log one
 * `activity_insert_outage`. That counter is best-effort: isolates are
 * short-lived and do not share it, so alert on the `activity_insert_failed`
 * warning.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  ;(logger as { child: () => typeof logger }).child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

import { awardPointsForEndUser, resetTransientActivityInsertAlert } from '../../supabase/functions/_shared/reputation.ts'

const GATEWAY_HTML =
  '<!DOCTYPE html><html><head><title>supabase.co | 502: Bad gateway</title></head>' +
  '<body><script>secret()</script>cloudflare</body></html>'

type InsertStep =
  | { throw: string }
  | { error: { message?: string; code?: string | null } | null; status: number }

function dbForInserts(script: InsertStep[], totalPoints = 10) {
  const inserts: unknown[] = []
  const thenable = (result: { data: unknown; error: unknown; status: number; count: number | null }) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      single: () => Promise.resolve(result),
    }
    for (const method of ['select', 'eq', 'gte', 'is', 'order', 'limit', 'update']) {
      builder[method] = () => builder
    }
    return builder
  }
  const db = {
    from(table: string) {
      if (table === 'end_user_activity') {
        return {
          insert(row: unknown) {
            const step = script[inserts.length] ?? script[script.length - 1]
            inserts.push(row)
            if (step && 'throw' in step) return Promise.reject(new Error(step.throw))
            return Promise.resolve({ data: null, error: step?.error ?? null, status: step && 'status' in step ? step.status : 201 })
          },
          select: () => thenable({ data: [], error: null, status: 200, count: 0 }),
        }
      }
      if (table === 'end_user_points') {
        return thenable({
          data: { total_points: totalPoints, current_tier_id: null },
          error: null,
          status: 200,
          count: null,
        })
      }
      return thenable({ data: [], error: null, status: 200, count: null })
    },
  }
  return { db, inserts }
}

function award(db: unknown, action: string, projectId: string) {
  return awardPointsForEndUser(db as never, {
    projectId,
    organizationId: '00000000-0000-4000-8000-000000000001',
    endUserId: '00000000-0000-4000-8000-000000000002',
    action,
  })
}

function logged(level: 'warn' | 'error', msg = 'activity_insert_failed') {
  return fakeLog[level].mock.calls.filter((call) => call[0] === msg)
}

beforeEach(() => {
  fakeLog.warn.mockClear()
  fakeLog.error.mockClear()
  resetTransientActivityInsertAlert()
})

describe('awardPointsForEndUser activity insert', () => {
  it('logs a gateway HTML body as a short warning and does not retry a heartbeat', async () => {
    const { db, inserts } = dbForInserts([{ error: { message: GATEWAY_HTML, code: null }, status: 502 }])
    const result = await award(db, 'session_minute', 'proj-activity-heartbeat')

    expect(result).toMatchObject({ pointsAwarded: 0, rejectedReason: 'insert_error' })
    expect(inserts).toHaveLength(1)
    expect(logged('error')).toEqual([])
    expect(logged('warn')).toEqual([
      [
        'activity_insert_failed',
        expect.objectContaining({
          action: 'session_minute',
          transient: true,
          status: 502,
          error: 'HTTP 502: [upstream gateway error] supabase.co | 502: Bad gateway',
        }),
      ],
    ])
    expect(JSON.stringify(logged('warn'))).not.toContain('<')
    expect(JSON.stringify(logged('warn'))).not.toContain('secret()')
  })

  it('retries a non-heartbeat award once when the gateway page is transient', async () => {
    const { db, inserts } = dbForInserts([
      { error: { message: GATEWAY_HTML, code: null }, status: 503 },
      { error: null, status: 201 },
    ])
    const result = await award(db, 'report.submitted', 'proj-activity-retry')

    expect(inserts).toHaveLength(2)
    expect(result.pointsAwarded).toBe(10)
    expect(result.rejectedReason).toBeNull()
    expect(logged('error')).toEqual([])
    expect(logged('warn')).toEqual([])
  })

  it('does not retry a 504 and still keeps the HTML page out of the log', async () => {
    const { db, inserts } = dbForInserts([{ error: { message: GATEWAY_HTML, code: null }, status: 504 }])
    const result = await award(db, 'report.submitted', 'proj-activity-504')

    expect(inserts).toHaveLength(1)
    expect(result.rejectedReason).toBe('insert_error')
    expect(logged('error')).toEqual([])
    expect(logged('warn')[0]?.[1]).toMatchObject({
      transient: true,
      status: 504,
      error: 'HTTP 504: [upstream gateway error] supabase.co | 502: Bad gateway',
    })
    expect(JSON.stringify(logged('warn'))).not.toContain('<')
  })

  it('does not retry a 502, which can arrive after the insert committed', async () => {
    for (const [message, projectId] of [
      [GATEWAY_HTML, 'proj-activity-502-html'],
      ['connect ECONNREFUSED 10.0.0.1:443', 'proj-activity-502-refused'],
    ] as const) {
      fakeLog.warn.mockClear()
      fakeLog.error.mockClear()
      const { db, inserts } = dbForInserts([{ error: { message, code: null }, status: 502 }])
      const result = await award(db, 'report.submitted', projectId)

      expect(inserts).toHaveLength(1)
      expect(result.rejectedReason).toBe('insert_error')
      expect(logged('error')).toEqual([])
      expect(logged('warn')).toHaveLength(1)
      expect(JSON.stringify(logged('warn'))).not.toContain('<')
    }
  })

  it('does not retry a pooler error or a connection reset', async () => {
    for (const message of [
      'upstream connect error or disconnect/reset before headers',
      'delayed connect error: 111',
      'read ECONNRESET',
    ]) {
      fakeLog.warn.mockClear()
      fakeLog.error.mockClear()
      const { db, inserts } = dbForInserts([{ throw: message }])
      const result = await award(db, 'report.submitted', `proj-activity-${message.slice(0, 8)}`)

      expect(inserts).toHaveLength(1)
      expect(result.rejectedReason).toBe('insert_error')
      expect(logged('error')).toEqual([])
      expect(logged('warn')).toHaveLength(1)
    }
  })

  it('does not retry a failed fetch unless the connection was refused', async () => {
    const { db, inserts } = dbForInserts([{ error: { message: 'fetch failed', code: null }, status: 0 }])
    const result = await award(db, 'report.submitted', 'proj-activity-fetch-failed')

    expect(inserts).toHaveLength(1)
    expect(result.rejectedReason).toBe('insert_error')
    expect(logged('error')).toEqual([])
    expect(logged('warn')).toHaveLength(1)
  })

  it('retries a refused connection once, because the insert was never sent', async () => {
    const { db, inserts } = dbForInserts([
      { throw: 'connect ECONNREFUSED 127.0.0.1:54321' },
      { error: null, status: 201 },
    ])
    const result = await award(db, 'report.submitted', 'proj-activity-refused')

    expect(inserts).toHaveLength(2)
    expect(result.pointsAwarded).toBe(10)
    expect(result.rejectedReason).toBeNull()
    expect(logged('error')).toEqual([])
    expect(logged('warn')).toEqual([])
  })

  it('retries a refused connection at most once and still reports the failure', async () => {
    const { db, inserts } = dbForInserts([{ throw: 'connection refused' }])
    const result = await award(db, 'report.submitted', 'proj-activity-refused-down')

    expect(inserts).toHaveLength(2)
    expect(result.rejectedReason).toBe('insert_error')
    expect(logged('warn')).toEqual([])
    expect(logged('error')).toEqual([
      [
        'activity_insert_failed',
        expect.objectContaining({
          action: 'report.submitted',
          error: 'connection refused',
        }),
      ],
    ])
  })

  it('documents the outage counter as best-effort per isolate', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/reputation.ts'), 'utf8')
    const at = src.indexOf('const TRANSIENT_INSERT_ALERT_AFTER')
    const block = src.slice(Math.max(0, at - 700), at)
    expect(block).toMatch(/best-effort/i)
    expect(block).toMatch(/short-lived/)
    expect(block).toMatch(/many run at once/)
    expect(block).toMatch(/activity_insert_failed/)
    expect(block).toMatch(/activity_insert_outage/)
  })

  it('raises one error after repeated transient insert failures, not one per heartbeat', async () => {
    const { db } = dbForInserts([{ error: { message: GATEWAY_HTML, code: null }, status: 502 }])
    for (let i = 0; i < 7; i++) await award(db, 'session_minute', 'proj-activity-outage')
    expect(logged('warn')).toHaveLength(7)
    expect(logged('error', 'activity_insert_outage')).toEqual([])

    await award(db, 'session_minute', 'proj-activity-outage')
    expect(logged('warn')).toHaveLength(8)
    expect(logged('error', 'activity_insert_outage')).toEqual([
      [
        'activity_insert_outage',
        expect.objectContaining({
          action: 'session_minute',
          transient: true,
          sustained: true,
          count: 8,
          status: 502,
          error: 'HTTP 502: [upstream gateway error] supabase.co | 502: Bad gateway',
        }),
      ],
    ])
    expect(JSON.stringify(logged('error', 'activity_insert_outage'))).not.toContain('<')
    expect(logged('error')).toEqual([])

    await award(db, 'session_minute', 'proj-activity-outage')
    expect(logged('warn')).toHaveLength(9)
    expect(logged('error', 'activity_insert_outage')).toHaveLength(1)
  })

  it('arms the outage error again in the next ten-minute window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-29T00:00:00Z'))
    try {
      const { db } = dbForInserts([{ error: { message: GATEWAY_HTML, code: null }, status: 502 }])
      for (let i = 0; i < 8; i++) await award(db, 'session_minute', 'proj-activity-outage-window')
      expect(logged('error', 'activity_insert_outage')).toHaveLength(1)

      await award(db, 'session_minute', 'proj-activity-outage-window')
      expect(logged('error', 'activity_insert_outage')).toHaveLength(1)

      vi.setSystemTime(new Date('2026-10-29T00:10:00Z'))
      for (let i = 0; i < 8; i++) await award(db, 'session_minute', 'proj-activity-outage-window')
      expect(logged('error', 'activity_insert_outage')).toHaveLength(2)
      expect(logged('error')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('still reports a real constraint failure, once, with its own message', async () => {
    const { db, inserts } = dbForInserts([
      { error: { message: 'duplicate key value violates unique constraint', code: '23505' }, status: 409 },
    ])
    const result = await award(db, 'report.submitted', 'proj-activity-constraint')

    expect(inserts).toHaveLength(1)
    expect(result.rejectedReason).toBe('insert_error')
    expect(logged('warn')).toEqual([])
    expect(logged('error')).toEqual([
      [
        'activity_insert_failed',
        expect.objectContaining({
          action: 'report.submitted',
          status: 409,
          error: 'duplicate key value violates unique constraint',
        }),
      ],
    ])
  })

  it('sanitizes a thrown HTML body the same way as a returned PostgREST error', async () => {
    const { db, inserts } = dbForInserts([{ throw: GATEWAY_HTML }])
    const result = await award(db, 'session_minute', 'proj-activity-throw')

    expect(inserts).toHaveLength(1)
    expect(result.rejectedReason).toBe('insert_error')
    expect(logged('error')).toEqual([])
    expect(JSON.stringify(logged('warn'))).not.toContain('<')
    expect(logged('warn')[0]?.[1]).toMatchObject({
      transient: true,
      error: '[upstream gateway error] supabase.co | 502: Bad gateway',
    })
  })
})
