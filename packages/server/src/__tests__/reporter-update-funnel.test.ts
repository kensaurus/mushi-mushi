/**
 * FILE: reporter-update-funnel.test.ts
 * PURPOSE: Reporter updates leads with a funnel in bug reports: told,
 *          opened, replied. Held and discarded Outbox rows never count as
 *          told, a reply only counts when it came after the first update,
 *          and a failed reply read gives null (unknown), never "0 replied".
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readReporterUpdateFunnel,
  reporterUpdateFunnel,
  type FunnelNotificationRow,
} from '../../supabase/functions/_shared/reporter-update-funnel.ts'

const rows: FunnelNotificationRow[] = [
  // r1: told twice, opened once, replied after the first update.
  { report_id: 'r1', read_at: null, created_at: '2026-10-20T10:00:00Z', status: 'sent' },
  { report_id: 'r1', read_at: '2026-10-21T09:00:00Z', created_at: '2026-10-21T08:00:00Z', status: 'sent' },
  // r2: told, never opened, replied BEFORE it was told (the original report text).
  { report_id: 'r2', read_at: null, created_at: '2026-10-22T10:00:00Z', status: 'sent' },
  // r3: only a held row: never reached the reporter.
  { report_id: 'r3', read_at: null, created_at: '2026-10-22T10:00:00Z', status: 'held' },
  // r4: discarded; no report id: neither counts.
  { report_id: 'r4', read_at: null, created_at: '2026-10-22T10:00:00Z', status: 'discarded' },
  { report_id: null, read_at: null, created_at: '2026-10-22T10:00:00Z', status: 'sent' },
]

const replies = new Map<string, string | null>([
  ['r1', '2026-10-21T10:00:00Z'],
  ['r2', '2026-10-19T10:00:00Z'],
])

describe('reporterUpdateFunnel', () => {
  it('counts reports told, opened and replied after the first update', () => {
    expect(reporterUpdateFunnel(rows, replies)).toEqual({ told: 2, opened: 1, replied: 1 })
  })
})

function fakeDb(opts: { fail?: boolean } = {}) {
  const chunks: string[][] = []
  const db = {
    from(table: string) {
      expect(table).toBe('reports')
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => {
            chunks.push(ids)
            if (opts.fail) return { data: null, error: { message: 'boom' } }
            return { data: ids.map((id) => ({ id, last_reporter_reply_at: replies.get(id) ?? null })), error: null }
          },
        }),
      }
    },
  }
  return { db: db as never, chunks }
}

describe('readReporterUpdateFunnel', () => {
  it('reads replies only for told reports', async () => {
    const { db, chunks } = fakeDb()
    expect(await readReporterUpdateFunnel(db, rows)).toEqual({ told: 2, opened: 1, replied: 1 })
    expect(chunks).toEqual([['r1', 'r2']])
  })

  it('reads in chunks of 100', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ report_id: `r${i}`, read_at: null, created_at: '2026-10-22T10:00:00Z', status: 'sent' }))
    const { db, chunks } = fakeDb()
    expect((await readReporterUpdateFunnel(db, many))?.told).toBe(250)
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50])
  })

  it('is null when the replies cannot be read', async () => {
    const { db } = fakeDb({ fail: true })
    expect(await readReporterUpdateFunnel(db, rows)).toBeNull()
  })
})

describe('GET /v1/admin/notifications/stats', () => {
  it('returns the funnel read from the same notification rows', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/admin-ops.ts'), 'utf8')
    expect(src).toMatch(/\.select\('notification_type, read_at, created_at, status, report_id'\)/)
    expect(src).toMatch(/const funnel = await readReporterUpdateFunnel\(db, list/)
  })
})
