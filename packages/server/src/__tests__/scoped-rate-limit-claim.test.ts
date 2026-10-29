/**
 * scoped_rate_limit_claim used to increment a full bucket and then raise,
 * which rolls the write back and leaves every extra caller waiting on the
 * row lock until statement_timeout. A full bucket is now rejected before
 * any lock, and a lock wait gives up as rate_limit_busy.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = '20261029140000_scoped_rate_limit_claim_lock_timeout.sql'

describe('scoped_rate_limit_claim lock wait', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations', MIGRATION), 'utf8')

  it('rejects a full bucket before taking the row lock', () => {
    const precheck = sql.indexOf('v_count >= p_max_per_window')
    const write = sql.indexOf('set request_count = request_count + 1')
    expect(precheck).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(precheck)
  })

  it('gives up on a locked row instead of waiting out statement_timeout', () => {
    expect(sql).toContain("set_config('lock_timeout', '250ms', true)")
    expect(sql).toContain('rate_limit_busy')
    expect(sql).toContain("errcode = '55P03'")
    expect(sql).toContain('when lock_not_available or deadlock_detected then')
  })

  it('the Helm copy is identical', () => {
    const helm = readFileSync(resolve(__dirname, '../../../../deploy/helm/migrations', MIGRATION), 'utf8')
    expect(helm).toBe(sql)
  })
})
