/**
 * FILE: anti-gaming-review-baseline.test.ts
 * PURPOSE: An unflag must stick, and a scripted client's flag must say so.
 *          A later report updates the token count in that sentence only.
 *
 * Regression (2026-10-08): one IP + User-Agent ("node") was flagged
 * multi-account in five projects. Unflag cleared the flag but kept the token
 * list, so the device's next report re-flagged it straight away.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({ logAntiGamingEvent: async () => {} }))

import {
  alignMultiAccountReason,
  checkAntiGaming,
  multiAccountReason,
  scriptedClientName,
  unreviewedTokenCount,
} from '../../supabase/functions/_shared/anti-gaming.ts'

const SCRIPTED =
  'Multi-account: 4 reporter tokens from one scripted client (node). A server sending reports for many users looks like this.'

const P = 'p1'
const FP = 'fp-node'
const tokens = (n: number) => Array.from({ length: n }, (_, i) => `rk1_${i}`)

function deviceDb(row: Record<string, unknown>) {
  return makeFakeDb({
    reporter_devices: [{ id: 'd1', project_id: P, device_fingerprint: FP, report_count: 0, ...row }],
    reports: [],
  })
}

describe('unreviewedTokenCount', () => {
  it('counts only tokens added since the last unflag', () => {
    expect(unreviewedTokenCount(16, 16)).toBe(0)
    expect(unreviewedTokenCount(17, 16)).toBe(1)
    expect(unreviewedTokenCount(4, 0)).toBe(4)
    expect(unreviewedTokenCount(4, null)).toBe(4)
    expect(unreviewedTokenCount(2, 5)).toBe(0)
  })
})

describe('multi-account check after an unflag', () => {
  it('a reviewed device is not re-flagged by its next report', async () => {
    const db = deviceDb({ reporter_tokens: tokens(16), flagged_as_suspicious: false, reviewed_token_count: 16 })
    const result = await checkAntiGaming(db as never, P, 'rk1_new', { fingerprint: FP, userAgent: 'node' })
    expect(result.flagged).toBe(false)
  })

  it('flags again once four new tokens arrive after the review', async () => {
    const db = deviceDb({ reporter_tokens: tokens(19), flagged_as_suspicious: false, reviewed_token_count: 16 })
    const result = await checkAntiGaming(db as never, P, 'rk1_new', { fingerprint: FP, userAgent: 'node' })
    expect(result.flagged).toBe(true)
    expect(result.reason).toContain('scripted client (node)')
  })

  it('raises only the count on a later report and keeps the scripted-client clause', async () => {
    const db = deviceDb({
      reporter_tokens: tokens(4),
      flagged_as_suspicious: true,
      flag_reason: SCRIPTED,
    })
    const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36'
    const result = await checkAntiGaming(db as never, P, 'rk1_new', { fingerprint: FP, userAgent: browser })
    const expected = SCRIPTED.replace('4 reporter tokens', '5 reporter tokens')
    expect(result.reason).toBe(expected)
    expect(db.table('reporter_devices')[0]?.flag_reason).toBe(expected)
  })

  it('does not relabel a same-device flag when a later request comes from a script', async () => {
    const same = 'Multi-account: 4 reporter tokens from same device'
    const db = deviceDb({
      reporter_tokens: tokens(4),
      flagged_as_suspicious: true,
      flag_reason: same,
    })
    const result = await checkAntiGaming(db as never, P, 'rk1_new', { fingerprint: FP, userAgent: 'node' })
    expect(result.reason).toBe('Multi-account: 5 reporter tokens from same device')
    expect(db.table('reporter_devices')[0]?.flag_reason).toBe('Multi-account: 5 reporter tokens from same device')
  })

  it('still flags a never-reviewed device past three tokens', async () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36'
    const db = deviceDb({ reporter_tokens: tokens(3), flagged_as_suspicious: false })
    const result = await checkAntiGaming(db as never, P, 'rk1_new', { fingerprint: FP, userAgent: ua })
    expect(result.flagged).toBe(true)
    expect(result.reason).toBe('Multi-account: 4 reporter tokens from same device')
  })
})

describe('alignMultiAccountReason', () => {
  it('replaces the count and leaves every other clause', () => {
    expect(alignMultiAccountReason(SCRIPTED, 16)).toBe(
      SCRIPTED.replace('4 reporter tokens', '16 reporter tokens'),
    )
    expect(alignMultiAccountReason('Multi-account: 4 reporter tokens from same device', 6)).toBe(
      'Multi-account: 6 reporter tokens from same device',
    )
  })

  it('leaves manual and velocity reasons alone', () => {
    expect(alignMultiAccountReason('Suspicious activity confirmed', 9)).toBe('Suspicious activity confirmed')
    expect(alignMultiAccountReason('Velocity anomaly: 12 reports in 24h', 9)).toBe(
      'Velocity anomaly: 12 reports in 24h',
    )
    expect(alignMultiAccountReason(null, 4)).toBeNull()
    expect(alignMultiAccountReason(undefined, 4)).toBeUndefined()
  })
})

describe('scriptedClientName', () => {
  it('names non-browser clients', () => {
    expect(scriptedClientName('node')).toBe('node')
    expect(scriptedClientName('curl/8.17.0')).toBe('curl')
    expect(scriptedClientName('python-requests/2.32.3')).toBe('python-requests')
  })

  it('treats browsers and mobile HTTP stacks as devices', () => {
    expect(scriptedClientName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBeNull()
    expect(scriptedClientName('okhttp/4.12.0')).toBeNull()
    expect(scriptedClientName('MyApp/12 CFNetwork/1568.100.1 Darwin/24.0.0')).toBeNull()
    expect(scriptedClientName('')).toBeNull()
    expect(scriptedClientName(undefined)).toBeNull()
  })

  it('only rewords the flag; it never exempts', () => {
    expect(multiAccountReason(5, 'node')).toMatch(/^Multi-account: 5 reporter tokens from one scripted client \(node\)/)
  })
})

describe('server-verified exemptions only', () => {
  const fnRoot = resolve(__dirname, '../../supabase/functions')
  const read = (rel: string) => readFileSync(resolve(fnRoot, rel), 'utf8')

  it('unflag records the reviewed token count', () => {
    const route = read('api/routes/admin-ops.ts')
    const unflag = route.slice(route.indexOf("'/v1/admin/anti-gaming/devices/:id/unflag'"))
    expect(unflag.slice(0, 2000)).toContain('reviewed_token_count: (device.reporter_tokens ?? []).length')
  })

  it('skipAntiGaming is passed only by the console test report route', () => {
    // A client-set header or metadata field must never be what exempts a report.
    const users = (readdirSync(fnRoot, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && read(f).includes('skipAntiGaming'))
      .sort()
    expect(users).toEqual(['api/helpers.ts', 'api/routes/project-integrations.ts'])
  })
})
