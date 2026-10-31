/**
 * `_shared/reputation.ts` — a failed end_user_activity insert.
 *
 * MUSHI-MUSHI-SERVER-3B (2026-10-27): a Cloudflare 521 page during a Supabase
 * outage was logged at error level with the whole HTML page attached. A
 * gateway outage is now a warn (not sent to Sentry); a coded failure still
 * pages.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const logged = vi.hoisted(() => ({
  warn: [] as Array<{ msg: string; meta?: Record<string, unknown> }>,
  error: [] as Array<{ msg: string; meta?: Record<string, unknown> }>,
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = {
    info: () => {},
    debug: () => {},
    warn: (msg: string, meta?: Record<string, unknown>) => logged.warn.push({ msg, meta }),
    error: (msg: string, meta?: Record<string, unknown>) => logged.error.push({ msg, meta }),
    child: () => l,
  }
  return { log: l }
})

type Reputation = typeof import('../../supabase/functions/_shared/reputation.ts')
let reputation: Reputation

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  reputation = await import('../../supabase/functions/_shared/reputation.ts')
})

beforeEach(() => {
  logged.warn.length = 0
  logged.error.length = 0
})

/** reward_rules reads empty; the end_user_activity insert fails with `insertError`. */
function db(insertError: { message: string; code?: string }) {
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'is', 'order', 'limit']) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return q
  }
  return {
    from: (table: string) => ({
      select: () => chain({ data: [], error: null, count: 0 }),
      insert: () => chain(table === 'end_user_activity' ? { data: null, error: insertError } : { data: null, error: null }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }
}

const OPTS = {
  projectId: 'p1',
  organizationId: 'o1',
  endUserId: 'u1',
  action: 'session_minute',
}

describe('awardPointsForEndUser when the activity insert fails', () => {
  it('logs a gateway outage page as a warn, with the page collapsed to its title', async () => {
    const page =
      '<!DOCTYPE html><head><title>supabase.co | 521: Web server is down</title></head><body>' + 'x'.repeat(4000)
    const out = await reputation.awardPointsForEndUser(db({ message: page }) as never, OPTS)
    expect(out.rejectedReason).toBe('insert_error')
    expect(logged.error).toEqual([])
    const warn = logged.warn.find((w) => w.msg === 'activity_insert_failed')
    expect(warn).toBeDefined()
    expect(String(warn!.meta?.error)).toContain('521: Web server is down')
    expect(String(warn!.meta?.error)).not.toContain('<!DOCTYPE')
  })

  it('keeps a coded failure at error level', async () => {
    const out = await reputation.awardPointsForEndUser(
      db({ message: 'insert or update on table violates foreign key constraint', code: '23503' }) as never,
      OPTS,
    )
    expect(out.rejectedReason).toBe('insert_error')
    expect(logged.error.map((e) => e.msg)).toContain('activity_insert_failed')
  })
})
