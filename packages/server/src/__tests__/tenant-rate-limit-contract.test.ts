/**
 * `_shared/tenant-observability.ts` — `claimTenantRateLimit` must call
 * `scoped_rate_limit_claim` with the argument names the deployed function
 * actually has.
 *
 * Regression (found on prod 2026-09-12): the helper called the RPC as
 * `(p_scope_key, p_limit, p_window_sec)`. No such overload exists — the real
 * signature is `(p_user_id uuid, p_scope text, p_max_per_window integer,
 * p_window interval)`. PostgREST answered "Could not find the function ... in
 * the schema cache" on every call, the helper's fail-open branch swallowed it,
 * and every limit routed through it was silently disabled: voice intake burst,
 * per-scope voice caps, skill-pipeline starts and the push self-test.
 *
 * This is the second time this exact failure shape has shipped here — see
 * 20260702035407_scoped_rate_limits_generalize_actor.sql, which fixed the same
 * silent fail-open in report-ingest limiting. Hence a contract test rather
 * than only a fix.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

type Tenant = typeof import('../../supabase/functions/_shared/tenant-observability.ts')
let tenant: Tenant

/** The deployed signature, verified against prod `pg_proc` on 2026-09-12. */
const DEPLOYED_ARGS = ['p_user_id', 'p_scope', 'p_max_per_window', 'p_window'] as const

function recordingDb(error: { message: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    calls,
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return Promise.resolve({ error })
    },
  }
}

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  tenant = await import('../../supabase/functions/_shared/tenant-observability.ts')
})

describe('claimTenantRateLimit RPC contract', () => {
  it('calls scoped_rate_limit_claim with exactly the deployed argument names', async () => {
    const db = recordingDb()
    await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 30, 60)

    expect(db.calls).toHaveLength(1)
    expect(db.calls[0]!.fn).toBe('scoped_rate_limit_claim')
    expect(Object.keys(db.calls[0]!.args).sort()).toEqual([...DEPLOYED_ARGS].sort())
  })

  it('never sends the arguments of the non-existent overload', async () => {
    const db = recordingDb()
    await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 30, 60)
    const args = db.calls[0]!.args
    for (const dead of ['p_scope_key', 'p_limit', 'p_window_sec']) {
      expect(args).not.toHaveProperty(dead)
    }
  })

  it('passes the window as a Postgres interval, not a bare number', async () => {
    const db = recordingDb()
    await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 30, 90)
    expect(db.calls[0]!.args.p_window).toBe('90 seconds')
    expect(db.calls[0]!.args.p_max_per_window).toBe(30)
    expect(db.calls[0]!.args.p_scope).toBe('project:p1:voice')
  })

  it('derives a uuid-shaped actor id from the scope key', async () => {
    const db = recordingDb()
    await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 30, 60)
    expect(db.calls[0]!.args.p_user_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('derives the actor deterministically, and differently per scope key', async () => {
    const a = await tenant.rateLimitActorId('project:p1:voice')
    const b = await tenant.rateLimitActorId('project:p1:voice')
    const c = await tenant.rateLimitActorId('project:p2:voice')
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('denies when the RPC raises rate_limit_exceeded', async () => {
    // The real message shape, captured from prod:
    // "rate_limit_exceeded: scope=probe_scope count=3 cap=2 window=00:01:00"
    const db = recordingDb({ message: 'rate_limit_exceeded: scope=probe_scope count=3 cap=2 window=00:01:00' })
    const out = await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 2, 60)
    expect(out.allowed).toBe(false)
    expect(out.retryAfterSec).toBe(60)
  })

  it('allows when the RPC succeeds', async () => {
    const db = recordingDb()
    expect(await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 30, 60)).toEqual({ allowed: true })
  })

  it('fails open on an unexpected RPC error rather than blocking traffic', async () => {
    const db = recordingDb({ message: 'connection reset by peer' })
    expect((await tenant.claimTenantRateLimit(db as never, 'project:p1:voice', 30, 60)).allowed).toBe(true)
  })
})
