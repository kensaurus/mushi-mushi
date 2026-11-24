/**
 * A full scoped_rate_limits window must raise rate_limit_exceeded without
 * writing. The previous body incremented and then raised, and the raise
 * rolled the increment back — so the count stayed at the cap, but every
 * rejected caller still took the row lock until statement_timeout.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { auto_explain } from '@electric-sql/pglite/contrib/auto_explain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261031150000_scoped_rate_limit_claim_full_window.sql'),
  'utf8',
)

const ACTOR = '10000000-0000-4000-8000-0000000000aa'
const OTHER = '10000000-0000-4000-8000-0000000000bb'

const logs: string[] = []
let db: PGlite

function pgError(error: unknown): { message: string; code?: string } {
  if (error && typeof error === 'object') {
    const row = error as { message?: string; code?: string }
    return { message: row.message ?? String(error), code: row.code }
  }
  return { message: String(error) }
}

async function claim(actor: string, scope: string, max: number): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select public.scoped_rate_limit_claim($1::uuid, $2, $3, interval '1 hour') as n`,
    [actor, scope, max],
  )
  return Number(result.rows[0].n)
}

async function stored(actor: string, scope: string): Promise<number | null> {
  const result = await db.query<{ request_count: number }>(
    `select request_count from public.scoped_rate_limits where user_id = $1 and scope = $2`,
    [actor, scope],
  )
  return result.rows[0] ? Number(result.rows[0].request_count) : null
}

describe('scoped_rate_limit_claim rejects a full window without writing', () => {
  beforeAll(async () => {
    db = new PGlite({
      extensions: { auto_explain },
      onStderr: (text) => {
        logs.push(text)
        return false
      },
    })
    await db.waitReady
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create table public.scoped_rate_limits (
        user_id uuid not null,
        scope text not null,
        window_start timestamptz not null,
        request_count integer not null default 0,
        primary key (user_id, scope, window_start)
      );
      load 'auto_explain';
      set auto_explain.log_min_duration = 0;
      set auto_explain.log_nested_statements = on;
      set auto_explain.log_analyze = on;
      set log_min_messages = log;
    `)
    await db.exec(MIGRATION)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  it('keeps the shared signature, service_role execute, and no lock timeout', async () => {
    const fn = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(`
      select p.prosecdef, p.proconfig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'scoped_rate_limit_claim'
    `)
    expect(fn.rows).toHaveLength(1)
    expect(fn.rows[0].prosecdef).toBe(true)
    expect(fn.rows[0].proconfig ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/lock_timeout|statement_timeout/)]))

    const priv = await db.query<{ anon: boolean; service: boolean }>(`
      select has_function_privilege('anon', 'public.scoped_rate_limit_claim(uuid, text, integer, interval)', 'execute') as anon,
             has_function_privilege('service_role', 'public.scoped_rate_limit_claim(uuid, text, integer, interval)', 'execute') as service
    `)
    expect(priv.rows[0].anon).toBe(false)
    expect(priv.rows[0].service).toBe(true)

    const body = MIGRATION.slice(MIGRATION.indexOf('as $fn$'))
    const guardAt = body.indexOf('v_count >= p_max_per_window')
    const insertAt = body.indexOf('insert into public.scoped_rate_limits')
    expect(guardAt).toBeGreaterThan(-1)
    expect(insertAt).toBeGreaterThan(guardAt)
    expect(body).toMatch(/where scoped_rate_limits\.request_count < p_max_per_window/)
    expect(body).not.toMatch(/lock_timeout|statement_timeout/)
  })

  it('counts up to the cap and then rejects without inserting again', async () => {
    logs.length = 0
    const counts = [await claim(ACTOR, 'sdk_sessions_ip', 3), await claim(ACTOR, 'sdk_sessions_ip', 3), await claim(ACTOR, 'sdk_sessions_ip', 3)]
    expect(counts).toEqual([1, 2, 3])
    expect(await stored(ACTOR, 'sdk_sessions_ip')).toBe(3)
    expect(logs.join('\n')).toContain('Insert on')

    logs.length = 0
    for (let i = 0; i < 5; i++) {
      try {
        await claim(ACTOR, 'sdk_sessions_ip', 3)
        throw new Error('expected rate_limit_exceeded')
      } catch (error) {
        const pg = pgError(error)
        if (pg.message === 'expected rate_limit_exceeded') throw error
        expect(pg.message).toContain('rate_limit_exceeded')
        expect(pg.code).toBe('P0001')
      }
    }
    expect(await stored(ACTOR, 'sdk_sessions_ip')).toBe(3)
    const rejected = logs.join('\n')
    expect(rejected).not.toContain('Insert on')
    expect(rejected).not.toContain('Update on')

    // A different actor, and a different scope for the same actor, each
    // have their own window.
    expect(await claim(OTHER, 'sdk_sessions_ip', 3)).toBe(1)
    expect(await claim(ACTOR, 'sdk_sessions', 3)).toBe(1)
    expect(await stored(ACTOR, 'sdk_sessions_ip')).toBe(3)
  })

  it('refuses a non-positive cap before touching the table', async () => {
    await expect(claim(ACTOR, 'sdk_sessions_ip', 0)).rejects.toThrow(/p_max_per_window must be > 0/)
    expect(await stored(ACTOR, 'sdk_sessions_ip')).toBe(3)
  })
})
