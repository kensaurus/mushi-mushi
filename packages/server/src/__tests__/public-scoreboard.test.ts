/**
 * FILE: public-scoreboard.test.ts
 * PURPOSE: The public /proof numbers and the free Production Check's table:
 *            - GET /v1/public/scoreboard passes on only the whitelisted
 *              aggregate keys (an extra column the SQL function might grow,
 *              like app names, never reaches the page), caches for 15 minutes,
 *              answers 503 with no board and keeps a stale board on a failed
 *              refresh;
 *            - the migration: production_checks has RLS on with no anon or
 *              authenticated policy and their grants revoked; both functions
 *              are SECURITY DEFINER with a fixed search_path and EXECUTE
 *              revoked from PUBLIC, anon and authenticated; the scoreboard
 *              counts only complimentary organizations' widget reports.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'npm:hono@4'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown }))
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

import {
  SCOREBOARD_TTL_MS,
  registerPublicScoreboardRoutes,
  resetScoreboardCache,
  toPublicScoreboard,
} from '../../supabase/functions/api/routes/public-scoreboard.ts'

const BOARD = {
  days: 60,
  apps: 9,
  user_reports: 676,
  reporters: 314,
  fixes_merged: 231,
  reviews: 738,
  reviews_hold: 265,
  median_hours_to_merged_fix: 26.4,
  weekly_merged: [
    { week_start: '2026-10-19', merged: 147 },
    { week_start: '2026-10-26', merged: 77 },
  ],
}

let db: FakeDb
let fail = false
let board: Record<string, unknown> = BOARD
let clock = Date.parse('2026-10-28T12:00:00Z')

function app() {
  const a = new Hono()
  registerPublicScoreboardRoutes(a as never, () => clock)
  return a
}

beforeEach(() => {
  resetScoreboardCache()
  fail = false
  board = BOARD
  clock = Date.parse('2026-10-28T12:00:00Z')
  db = makeFakeDb({}, { rpc: () => board, rpcError: (fn) => (fail && fn === 'public_scoreboard' ? { code: 'XX000', message: 'timeout' } : null) })
  state.db = db
})

describe('GET /v1/public/scoreboard', () => {
  it('returns only the aggregate numbers, dated', async () => {
    board = { ...BOARD, app_names: ['glot.it'], top_reporter: 'someone@example.com' }
    const res = await app().request('/v1/public/scoreboard')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=900')
    const { data } = (await res.json()) as { data: Record<string, unknown> }
    expect(Object.keys(data).sort()).toEqual(
      ['apps', 'asOf', 'days', 'fixesMerged', 'medianHoursToMergedFix', 'reporters', 'reviews', 'reviewsHold', 'userReports', 'weeklyMerged'].sort(),
    )
    expect(data).toMatchObject({ apps: 9, userReports: 676, reporters: 314, fixesMerged: 231, reviews: 738, reviewsHold: 265, medianHoursToMergedFix: 26.4, asOf: '2026-10-28T12:00:00.000Z' })
    expect(JSON.stringify(data)).not.toContain('glot.it')
    expect(db.rpcCalls).toEqual([{ fn: 'public_scoreboard', args: { p_days: 60 } }])
  })

  it('caches for 15 minutes', async () => {
    await app().request('/v1/public/scoreboard')
    clock += SCOREBOARD_TTL_MS - 1
    await app().request('/v1/public/scoreboard')
    expect(db.rpcCalls).toHaveLength(1)
    clock += 2
    await app().request('/v1/public/scoreboard')
    expect(db.rpcCalls).toHaveLength(2)
  })

  it('503 with nothing cached; the last board (with its date) after a failed refresh', async () => {
    fail = true
    expect((await app().request('/v1/public/scoreboard')).status).toBe(503)
    fail = false
    await app().request('/v1/public/scoreboard')
    clock += SCOREBOARD_TTL_MS + 1
    fail = true
    const res = await app().request('/v1/public/scoreboard')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { asOf: string } }).data.asOf).toBe('2026-10-28T12:00:00.000Z')
  })

  it('toPublicScoreboard drops junk and keeps a missing median as null', () => {
    const b = toPublicScoreboard({ apps: '9', user_reports: -3, median_hours_to_merged_fix: null, weekly_merged: [{ week_start: 'x', merged: 1 }, { week_start: '2026-10-26', merged: '4' }] }, new Date(0))
    expect(b).toMatchObject({ apps: 9, userReports: 0, medianHoursToMergedFix: null, weeklyMerged: [{ weekStart: '2026-10-26', merged: 4 }] })
  })
})

describe('migration 20261028200000_production_checks_and_scoreboard.sql', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261028200000_production_checks_and_scoreboard.sql'), 'utf8')
  const code = sql.replace(/--.*$/gm, '')

  it('production_checks is service role only (RLS on, no anon/authenticated policy, grants revoked)', () => {
    expect(code).toMatch(/ALTER TABLE public\.production_checks ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.production_checks FROM anon, authenticated/)
    const policies = code.match(/CREATE POLICY[\s\S]*?;/g) ?? []
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/TO service_role/)
    expect(code).not.toMatch(/\bTO\s+(anon|authenticated|public)\s*[;,(]|\bTO\s+(anon|authenticated)\b/i)
  })

  it('both functions are SECURITY DEFINER with a fixed search_path and no anon EXECUTE', () => {
    for (const fn of ['production_check_begin', 'public_scoreboard']) {
      const body = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?\\$\\$;`).exec(code)?.[0] ?? ''
      expect(body).toMatch(/SECURITY DEFINER/)
      expect(body).toMatch(/SET search_path = public/)
      expect(code).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`))
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`))
    }
  })

  it('the origin claim takes a lock and only reuses a finished or still-running check', () => {
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('production_check:' \|\| p_origin, 0\)\)/)
    expect(code).toMatch(/interval '24 hours'/)
    expect(code).toMatch(/pc\.status = 'running' AND pc\.created_at > now\(\) - interval '2 minutes'/)
  })

  it('the scoreboard counts only the owner\'s complimentary apps and user (widget) reports, in aggregate', () => {
    const body = /CREATE OR REPLACE FUNCTION public\.public_scoreboard[\s\S]*?\$\$;/.exec(code)?.[0] ?? ''
    expect(body).toMatch(/o\.billing_mode = 'complimentary'/)
    expect(body).toMatch(/r\.source = 'widget'/)
    expect(body).toMatch(/count\(DISTINCT reporter_token_hash\)/)
    expect(body).toMatch(/verdict = 'hold'/)
    expect(body).not.toMatch(/p\.name|p\.slug|description|summary|email/)
  })
})
